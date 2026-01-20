const { BrowserWindow, ipcMain, shell, dialog } = require('electron')
const { process, getMinecraftServerProcess, getOutputData } = require('./minecraft');
const path = require('node:path')
const fs = require('fs');
const https = require('https');
const { updateServerPropertiesOnlineMode, updateServerPropertiesLevelName,  createEulaFile, readServerProperties, getPluginInformation, parseManifest } = require("./fileSystem");

function registerMinecraftIpcEvents() {

    ipcMain.on('runMinecraftServer', async (event, args) => {
        console.log('Try to Run Minecraft Server');
        try {
            const { serverPath, xmx, xms } = args;
            const linkToMcServer = process(serverPath, xmx, xms, event);
        } catch (error) {
            console.error('runMinecraftServer', error);
        }
    });

    ipcMain.on('checkMinecraftServerStatus', (event) => {
        const isRunning = isMinecraftServerRunning();
        // console.log('checkMinecraftServerStatus --> ', isRunning)
        event.sender.send('checkMinecraftServerStatus', { running: isRunning });
    });

    ipcMain.on('getServerManifestData', async (event, args) => {
        try {
            const { serverPath } = args;
            const versionInfo = await parseManifest(serverPath);
            if (versionInfo) {
                // console.log('Version Info:', versionInfo);
                event.sender.send('getServerManifestData', { serverData: versionInfo });
            } else {
                event.sender.send('getServerManifestData', { serverData: {} });
                console.log('Failed to get version info.');
            }
        } catch (error) {
            console.error('Error:', error);
        }
    });





    ipcMain.on('getTerminalCommandsHistory', (event) => {
        const terminalHistory = getOutputData();
        event.sender.send('getTerminalCommandsHistory', { terminalHistory: terminalHistory });
    });

    ipcMain.on('getInfoAboutInstalledPlugins', async (event, args) => {
        try {
            const plugins = await getPluginInformation(args.serverPath);
            // console.log('plugins-->>>', plugins);
            event.sender.send('getInfoAboutInstalledPlugins', { plugins: plugins });
        } catch (error) {
            console.error('Error getting information about installed plugins:', error);
            event.sender.send('getInfoAboutInstalledPlugins', { error: error.message });
        }
    });



    ipcMain.on('openFileExplorerByPath', (event, path) => {
        console.log('path to open:', path.path)
        shell.openPath(path.path);
    });

    ipcMain.on('installMinecraftServerByUrl', async (event, url) => {
        try {
            const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });

            if (!result.canceled && result.filePaths.length > 0) {
                let selectedDirectory = result.filePaths[0];
                console.log('Selected directory:', selectedDirectory);

                if (fs.existsSync(selectedDirectory) && fs.readdirSync(selectedDirectory).length !== 0) {
                    console.log('Folder is not empty.');

                    // Check if it contains the "minecraftServer" folder
                    const minecraftServerFolder = path.join(selectedDirectory, 'minecraftServer');
                    if (!fs.existsSync(minecraftServerFolder)) {
                        // If it doesn't exist, add "minecraftServer" folder
                        fs.mkdirSync(minecraftServerFolder);
                        console.log('"minecraftServer" folder added to the path.');
                    }
                    selectedDirectory = minecraftServerFolder;
                }

                const fileName = path.basename(url); // Nombre del archivo desde la URL
                const destinationFilePath = path.join(selectedDirectory, fileName); // Formar la ruta final
                const fileStream = fs.createWriteStream(destinationFilePath);

                https.get(url, (response) => {
                    if (response.statusCode === 200) {
                        const totalLength = parseInt(response.headers['content-length'], 10);
                        let downloadedLength = 0;

                        response.on('data', (chunk) => {
                            downloadedLength += chunk.length;
                            const progress = Math.round((downloadedLength / totalLength) * 100);
                            event.reply('installMinecraftServerByUrl', { progress });
                            fileStream.write(chunk);
                        });

                        response.on('end', () => {
                            fileStream.end();
                            console.log('File downloaded successfully');
                            createEulaFile(selectedDirectory);
                            event.reply('installMinecraftServerByUrl', { success: true, destinationFilePath });
                        });
                    } else {
                        fs.unlinkSync(destinationFilePath); // Eliminar archivo si la descarga falla
                        console.error('Failed to download file. HTTP status code:', response.statusCode);
                        event.reply('installMinecraftServerByUrl', { success: false, error: `Failed to download file. HTTP status code: ${response.statusCode}` });
                    }
                }).on('error', (err) => {
                    fs.unlinkSync(destinationFilePath); // Eliminar archivo si la descarga falla
                    console.error('Error downloading file:', err.message);
                    event.reply('installMinecraftServerByUrl', { success: false, error: `Error downloading file: ${err.message}` });
                });
            } else {
                event.reply('installMinecraftServerByUrl', { success: false, error: 'User canceled directory selection' });
            }
        } catch (err) {
            console.error(err);
            event.reply('installMinecraftServerByUrl', { success: false, error: err.message });
        }
    });


    ipcMain.on('selectFolderPath', async (event) => {
        try {
            const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });

            if (!result.canceled && result.filePaths.length > 0) {
                let selectedDirectory = result.filePaths[0];
                console.log('Selected directory:', selectedDirectory);

                if (!fs.existsSync(selectedDirectory)) {
                    fs.mkdirSync(selectedDirectory, { recursive: true }); // Crear carpeta recursivamente si no existe
                    console.log('Directory created:', selectedDirectory);
                } else if (fs.readdirSync(selectedDirectory).length !== 0) {
                    console.log('Folder is not empty.');
                    selectedDirectory = path.join(selectedDirectory, 'minecraftServer');
                    if (!fs.existsSync(selectedDirectory)) {
                        fs.mkdirSync(selectedDirectory); // Si la carpeta no está vacía, crear carpeta minecraftServer dentro
                        console.log('"minecraftServer" folder added to the path.');
                    }
                }

                event.reply('selectFolderPath', { success: true, selectedDirectory });
            } else {
                event.reply('selectFolderPath', { success: false, error: 'User canceled directory selection' });
            }
        } catch (err) {
            console.error(err);
            event.reply('selectFolderPath', { success: false, error: err.message });
        }
    });


    ipcMain.on('downloadFile', async (event, args) => {
        const { folderPath, url } = args;

        // Verificar existencia de la carpeta y crear si no existe
        if (!fs.existsSync(folderPath)) {
            try {
                fs.mkdirSync(folderPath, { recursive: true });
                console.log('Folder did not exist and was created.');
            } catch (err) {
                event.reply('downloadFile', { success: false, error: `Failed to create folder: ${err.message}` });
                return;
            }
        }

        const fileName = path.basename(url);
        const destinationFilePath = path.join(folderPath, fileName);
        const fileStream = fs.createWriteStream(destinationFilePath);

        https.get(url, (response) => {
            if (response.statusCode === 200) {
                const totalLength = parseInt(response.headers['content-length'], 10);
                let downloadedLength = 0;

                response.on('data', (chunk) => {
                    downloadedLength += chunk.length;
                    const progress = Math.round((downloadedLength / totalLength) * 100);
                    event.reply('downloadFile', { progress });
                    fileStream.write(chunk);
                });

                response.on('end', () => {
                    fileStream.end();
                    console.log('File downloaded successfully');
                    createEulaFile(folderPath);
                    event.reply('downloadFile', { success: true, filePath: destinationFilePath });
                });
            } else {
                fs.unlinkSync(destinationFilePath);
                console.error('Failed to download file. HTTP status code:', response.statusCode);
                event.reply('downloadFile', { success: false, error: `Failed to download file. HTTP status code: ${response.statusCode}` });
            }
        }).on('error', (err) => {
            fs.unlinkSync(destinationFilePath);
            console.error('Error downloading file:', err.message);
            event.reply('downloadFile', { success: false, error: `Error downloading file: ${err.message}` });
        });
    });

    function downloadFileToFolder(folderPath, url) {
        if (!fs.existsSync(folderPath)) {
            return Promise.reject("Folder doesn't exist.");
        }

        return new Promise((resolve, reject) => {
            const fileName = path.basename(url);
            const destinationFilePath = path.join(folderPath, fileName);
            const fileStream = fs.createWriteStream(destinationFilePath);

            https.get(url, (response) => {
                if (response.statusCode === 200) {
                    const totalLength = parseInt(response.headers['content-length'], 10);
                    let downloadedLength = 0;

                    response.on('data', (chunk) => {
                        downloadedLength += chunk.length;
                        const progress = Math.round((downloadedLength / totalLength) * 100);
                        // Update progress here if needed
                        fileStream.write(chunk);
                    });

                    response.on('end', () => {
                        fileStream.end();
                        console.log('File downloaded successfully');
                        resolve(destinationFilePath);
                    });
                } else {
                    fs.unlinkSync(destinationFilePath);
                    reject(`Failed to download file. HTTP status code: ${response.statusCode}`);
                }
            }).on('error', (err) => {
                fs.unlinkSync(destinationFilePath);
                reject(`Error downloading file: ${err.message}`);
            });
        });
    }

    ipcMain.on('installMinecraftPluginByUrl', async (event, args) => {
        try {
            let { url, serverPluginsPath, fileName, oldFileName } = args;

            // Verificar existencia de la carpeta y crearla si no existe
            await ensureDirectoryExists(serverPluginsPath);

            console.log(args, '<<- installMinecraftPluginByUrl')

            if (!fileName)  fileName = path.basename(url); // Nombre del archivo desde la URL
            // console.log('fileName:', fileName)
            const destinationFilePath = path.join(serverPluginsPath, fileName); // Formar la ruta final



        // Eliminar archivo viejo si está especificado y existe
        if (oldFileName) {
            const oldFilePathToDelete = path.join(serverPluginsPath, oldFileName);
            if (fs.existsSync(oldFilePathToDelete)) {
                try {
                    fs.unlinkSync(oldFilePathToDelete);
                    console.log(`Successfully deleted old file: ${oldFilePathToDelete}`);
                } catch (deleteError) {
                    console.error(`Failed to delete old file: ${oldFilePathToDelete}`, deleteError.message);
                    event.reply('installMinecraftPluginByUrl', { success: false, error: `Failed to delete old file: ${deleteError.message}` });
                    return;
                }
            }
        }

            const fileStream = fs.createWriteStream(destinationFilePath);

            https.get(url, (response) => {
                if (response.statusCode === 200) {
                    const totalLength = parseInt(response.headers['content-length'], 10);
                    let downloadedLength = 0;

                    response.on('data', (chunk) => {
                        downloadedLength += chunk.length;
                        const progress = Math.round((downloadedLength / totalLength) * 100);
                        event.reply('installMinecraftPluginByUrl', { progress });
                        fileStream.write(chunk);
                    });

                    response.on('end', () => {
                        fileStream.end();
                        console.log('File downloaded successfully');
                        event.reply('installMinecraftPluginByUrl', { success: true, destinationFilePath });
                    });
                } else {
                    fs.unlinkSync(destinationFilePath); // Eliminar archivo si la descarga falla
                    console.error('Failed to download file. HTTP status code:', response.statusCode);
                    event.reply('installMinecraftPluginByUrl', { success: false, error: `Failed to download file. HTTP status code: ${response.statusCode}` });
                }
            }).on('error', (err) => {
                fs.unlinkSync(destinationFilePath); // Eliminar archivo si la descarga falla
                console.error('Error downloading file:', err.message);
                event.reply('installMinecraftPluginByUrl', { success: false, error: `Error downloading file: ${err.message}` });
            });
        } catch (err) {
            console.error(err);
            event.reply('installMinecraftPluginByUrl', { success: false, error: err.message });
        }
    });

    function ensureDirectoryExists(directory) {
        return new Promise((resolve, reject) => {
            fs.mkdir(directory, { recursive: true }, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    ipcMain.on('changeMinecraftOnlineMode', async (event, args) => {
        const { path, onlineMode } = args
        updateServerPropertiesOnlineMode(path, onlineMode)
    })

    ipcMain.on('changeMinecraftLevelName', async (event, args) => {
        const { path, levelName } = args
        updateServerPropertiesLevelName(path, levelName)
    })



    ipcMain.on('getMinecraftServerProperties', async (event, args) => {
        const { path } = args
        event.reply('getMinecraftServerProperties', readServerProperties(path));
    })


    ipcMain.on('openFileInDefaultEditor', (event, path) => {
        console.log('open file by path', path);
        const normalizedPath = path.path.replace(/\\/g, '/');

        // Verificar existencia del archivo
        fs.access(normalizedPath, fs.constants.F_OK, (err) => {
            if (err) {
                console.error(`File not found: ${normalizedPath}`);
                // Aquí puedes enviar un mensaje de error de vuelta al proceso principal
                event.sender.send('fileOpenError', { message: `File not found: ${normalizedPath}` });
                return;
            }

            // Abrir archivo
            shell.openPath(normalizedPath);
        });
    });


    function isMinecraftServerRunning() {
        const process = getMinecraftServerProcess();
        return process && process.connected;
    }

    ipcMain.on('sendCommandToMinecraftServer', async (event, args) => {
        // console.log(`Try to send command to Minecraft Server: ${args.command}`);
        try {
            const minecraftProcess = getMinecraftServerProcess();
            if (minecraftProcess) {
                sendCommandToMinecraftConsole(minecraftProcess, args.command);
            } else {
                throw new Error('Minecraft server process is not running.');
            }
        } catch (error) {
            event.sender.send('minecraftCommandSent', {
                success: false,
                message: `Failed to send command. Error: ${error.message}`,
            });
        }
    });

    function sendCommandToMinecraftConsole(serverProcess, command) {
        if (serverProcess.stdin) {
            // console.log('sendCommandToMinecraftConsole-->', command)
            serverProcess.stdin.write(`${command}\n`);
        } else {
            throw new Error('Server process does not have a valid stdin stream.');
        }
    }
}

module.exports = { registerMinecraftIpcEvents: () => registerMinecraftIpcEvents() };
