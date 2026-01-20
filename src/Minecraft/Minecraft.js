const { spawn } = require('child_process');
const { spawnSync } = require('child_process');
const path = require('path');
const AnsiToHtml = require('ansi-to-html');
const escapeHtml = require('escape-html');
const ansiConverter = new AnsiToHtml();
const fs = require('fs');
const iconv = require('iconv-lite');

// Función para enviar logs a través del socket al launcher
function sendLogToLauncher(logMessage) {
    // console.log('[sendLogToLauncher] Checking socket state...');
    // console.log('[sendLogToLauncher] global.s4eLauncherSocket exists:', !!global.s4eLauncherSocket);
    // console.log('[sendLogToLauncher] global.socketConnectionInfo:', global.socketConnectionInfo);

    // Enviar log si hay una conexión WebSocket activa (independientemente del tipo de cliente)
    if (global.s4eLauncherSocket && global.s4eLauncherSocket.readyState === 1) {
        try {
            const logEvent = {
                type: 'MinecraftServerLog',
                message: logMessage,
                timestamp: new Date().toISOString()
            };
            console.log('logEvent s4eLauncherSocket', logEvent);
            global.s4eLauncherSocket.send(JSON.stringify(logEvent));
            // console.log('[sendLogToLauncher] Log sent successfully');
        } catch (error) {
            console.error('Error sending log to launcher:', error);
        }
    } else {
        // console.warn('[sendLogToLauncher] Socket not ready or missing');
        // console.warn('[sendLogToLauncher] Socket readyState:', global.s4eLauncherSocket?.readyState);
    }
}

let minecraftServerProcess;
let onlinePlayers = []
let outputData = '';


function runMinecraftServer(serverPath, xmx, xms, event) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(serverPath)) {
            event.sender.send('checkMinecraftServerStatus', {
                running: false,
                message: 'no file in directory, please select new server file'
            });
            reject(`Server file not found: ${serverPath}`);
            return;
        }

        // Guardar la dirección del servidor en variables globales
        global.minecraftServerPath = serverPath;
        global.minecraftServerXmx = xmx;
        global.minecraftServerXms = xms;

        const serverDir = path.dirname(serverPath);

        // Buscar la primera carpeta que comience con jdk-
        let javaExecutable = 'java'; // Por defecto — java del sistema
        try {
            const filesInDir = fs.readdirSync(serverDir, { withFileTypes: true });
            const jdkFolder = filesInDir.find(
                (entry) => entry.isDirectory() && entry.name.startsWith('jdk-')
            );

            if (jdkFolder) {
                const customJavaPath = path.join(
                    serverDir,
                    jdkFolder.name,
                    'bin',
                    process.platform === 'win32' ? 'java.exe' : 'java'
                );

                if (fs.existsSync(customJavaPath)) {
                    javaExecutable = customJavaPath;
                }
            }
        } catch (err) {
            console.warn('Error while searching for JDK folder:', err);
        }

        const args = [
            `-Xmx${xmx}`,
            `-Xms${xms}`,
            '-Dfile.encoding=UTF-8',
            '-jar',
            serverPath,
            'nogui'
        ];

        minecraftServerProcess = spawn(javaExecutable, args, {
            cwd: serverDir,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });

        minecraftServerProcess.stdout.on('data', (data) => {
            const MAX_LENGTH = 100000;
            if (data.length > MAX_LENGTH) return;

            const message = iconv.decode(data, 'utf-8');
            if (!message || message.length === 0) return;

            const escapedMessage = escapeHtml(message);
            const htmlMessage = ansiConverter.toHtml(escapedMessage);
            outputData += htmlMessage;
            cutLines();
            console.log(`stdout: ${message}`);
            event.sender.send('minecraftServerOutput', htmlMessage);

            // Enviar log al launcher a través del socket
            sendLogToLauncher(message);

            // // Procesar información de jugadores
            // processPlayerInfo(message);

            if (message.includes('Done (') && message.includes(')!')) {
                event.sender.send('checkMinecraftServerStatus', { running: true });
            }
        });

        function cutLines() {
            if (outputData.length < 10000) return;
            const outputLines = outputData.split('\n');
            if (outputLines.length > 500) {
                outputData = outputLines.slice(-500).join('\n');
            }
        }

        minecraftServerProcess.stderr.on('data', (data) => {
            const MAX_LENGTH = 100000;
            if (data.length > MAX_LENGTH) return;

            const errorMessage = data.toString();
            outputData += errorMessage;
            cutLines();
            console.error(`stderr: ${errorMessage}`);
            event.sender.send('minecraftServerOutput', errorMessage);

            // Enviar error al launcher a través del socket
            sendLogToLauncher(errorMessage);

            reject(errorMessage);
        });

        minecraftServerProcess.on('close', (code) => {
            console.log(`Server process exited with code ${code}`);
            killMinecraftServerProcess();
            event.sender.send('checkMinecraftServerStatus', { running: false });

            // Limpiar variables globales al detener el servidor
            global.minecraftServerPath = null;
            global.minecraftServerXmx = null;
            global.minecraftServerXms = null;

            code === 0 ? resolve(outputData) : reject(`Server process exited with non-zero code: ${code}`);
        });

        minecraftServerProcess.on('message', (message) => {
            if (message === 'stop') {
                console.log('Received stop signal. Stopping the server...');
                minecraftServerProcess.stdin.write('stop\n');
            }
        });

        minecraftServerProcess.on('exit', (code, signal) => {
            console.log(`Server process exited with code ${code} and signal ${signal}`);
        });
    });
}

function killMinecraftServerProcess() {
    if (minecraftServerProcess && minecraftServerProcess.connected) {
        try {
            minecraftServerProcess.stdin.write('stop\n');
        } catch (err) {
            console.error('Error while killing the Minecraft server process:', err);
        }
    }
}

function getOutputData() {
    return outputData;
}

function processPlayerInfo(message) {
    const playerJoinMatch = message.match(/([a-zA-Z0-9_]+) joined the game/);
    const playerLeaveMatch = message.match(/([a-zA-Z0-9_]+) left the game/);
    const playerIPMatch = message.match(/\[([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+):[0-9]+\]/);
    const playerUUIDMatch = message.match(/UUID of player (.+) is ([a-f0-9\-]+)/);

    if (playerJoinMatch) {
        const playerName = playerJoinMatch[1];
        const playerIP = playerIPMatch ? playerIPMatch[1] : 'unknown';
        const joinTimestamp = new Date().toLocaleString();
        const playerUUID = playerUUIDMatch ? playerUUIDMatch[2] : 'unknown';

        const playerInfo = {
            name: playerName,
            ip: playerIP,
            joinedAt: joinTimestamp,
            uuid: playerUUID,
        };

        onlinePlayers.push(playerInfo);
        console.log(`Player ${playerName} joined from IP ${playerIP} at ${joinTimestamp}, UUID: ${playerUUID}`);

        // Enviar información de conexión del jugador al launcher
        sendLogToLauncher(`Player ${playerName} joined from IP ${playerIP} at ${joinTimestamp}, UUID: ${playerUUID}`);
    }

    if (playerLeaveMatch) {
        const playerName = playerLeaveMatch[1];
        const leaveTimestamp = new Date().toLocaleString();

        const playerIndex = onlinePlayers.findIndex(player => player.name === playerName);
        if (playerIndex !== -1) {
            const playerInfo = onlinePlayers.splice(playerIndex, 1)[0];
            console.log(`Player ${playerName} left at ${leaveTimestamp}`);

            // Enviar información de desconexión del jugador al launcher
            sendLogToLauncher(`Player ${playerName} left at ${leaveTimestamp}`);
        }
    }

    console.log(onlinePlayers);
}

function isMinecraftServerRunning() {
    return minecraftServerProcess && !minecraftServerProcess.killed && !!global.minecraftServerPath;
}

module.exports = {
    process: runMinecraftServer,
    getOutputData: () => getOutputData(),
    getMinecraftServerProcess: () => minecraftServerProcess,
    killMinecraftServerProcess: () => killMinecraftServerProcess(),
    isServerRunning: () => isMinecraftServerRunning()
};
