const path = require('node:path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const JSZip = require('jszip');
const jsyaml = require('js-yaml');

async function createEulaFile(directoryPath) {
    const currentDate = new Date().toUTCString();
    const eulaContent = `#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\n#${currentDate}\neula=true`;
    const filePath = path.join(directoryPath, 'eula.txt');

    try {
        await fsPromises.access(directoryPath, fs.constants.W_OK);
        await fsPromises.writeFile(filePath, eulaContent);
        await fsPromises.chmod(filePath, 0o644); // Set permissions to ensure read-write for owner, read for others
        console.log('EULA file created successfully:', filePath);
    } catch (error) {
        console.error('Error creating EULA file:', error.message);
    }
}

async function updateServerProperties(directoryPath, property, value) {
    const filePath = path.join(directoryPath, 'server.properties');

    try {
        await fsPromises.access(directoryPath, fs.constants.W_OK);

        let properties;
        if (fs.existsSync(filePath)) {
            properties = await fsPromises.readFile(filePath, 'utf8');
        } else {
            properties = '';
        }

        const propertyRegex = new RegExp(`(${property}\\s*=\\s*)(\\w+)`);
        if (propertyRegex.test(properties)) {
            properties = properties.replace(propertyRegex, `$1${value}`);
        } else {
            properties += `\n# Minecraft server properties\n${property}=${value}\n`;
        }

        await fsPromises.writeFile(filePath, properties);
        await fsPromises.chmod(filePath, 0o644);
        console.log('server.properties file updated successfully:', filePath);
    } catch (error) {
        console.error(`Error updating server.properties file:`, error.message);
    }
}

async function readServerProperties(directoryPath) {
    const filePath = path.join(directoryPath, 'server.properties');
    const result = {};

    try {
        const propertiesContent = await fsPromises.readFile(filePath, 'utf8');
        const lines = propertiesContent.split('\n').filter(line => !line.trim().startsWith('#'));

        lines.forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                const formattedKey = key.trim().replace(/-/g, '_');
                result[formattedKey] = value.trim() === 'true' ? true : value.trim() === 'false' ? false : value.trim();
            }
        });

        console.log('server.properties file read successfully:', filePath);
    } catch (error) {
        console.error('Error reading server.properties file:', error.message);
    }

    return result;
}

async function parseManifest(jarFilePath) {
    try {
        const jarFileContent = await fsPromises.readFile(jarFilePath);
        const zip = new JSZip();
        const zipFile = await zip.loadAsync(jarFileContent);
        const versionJsonFile = zipFile.file('version.json');

        if (!versionJsonFile) {
            console.warn(`File version.json not found in ${jarFilePath}`);
            return {};
        }

        const versionJsonContent = await versionJsonFile.async('string');
        return JSON.parse(versionJsonContent);
    } catch (error) {
        console.error(`Error parsing version.json in ${jarFilePath}:`, error.message);
        return null;
    }
}

async function getPluginInformation(serverFolderPath) {
    const pluginsFolderPath = path.join(serverFolderPath, 'plugins');

    // const isAccessible = await checkFolderAccess(pluginsFolderPath);
    // console.log('serverFolderPath ', serverFolderPath);
    // console.log('pluginsFolderPath ', pluginsFolderPath);
    // console.log('isAccessible ', isAccessible, pluginsFolderPath );

    try {
        const pluginsFolderStats = await fsPromises.stat(pluginsFolderPath);
        if (!pluginsFolderStats.isDirectory()) {
            throw new Error(`${pluginsFolderPath} is not a directory`);
        }
    } catch (err) {
        console.error(`Error reading plugins folder: ${err.message}`);
        return [];
    }

    const pluginFiles = await fsPromises.readdir(pluginsFolderPath);
    const pluginInformationPromises = pluginFiles
        .filter(pluginFile => pluginFile.endsWith('.jar'))
        .map(pluginFile => readPluginInfoFromJar(path.join(pluginsFolderPath, pluginFile)));

    return await Promise.all(pluginInformationPromises);
}

async function checkFolderAccess(folderPath) {
    try {
        await fs.access(folderPath, fs.constants.R_OK | fs.constants.W_OK);
        console.log(`${folderPath} is accessible.`);
    } catch (err) {
        console.error(`No access to ${folderPath}:`, err.message);
    }
}

async function readPluginInfoFromJar(jarFilePath) {
    const pluginName = path.basename(jarFilePath, '.jar');

    try {
        const buffer = await fsPromises.readFile(jarFilePath);
        const zip = new JSZip();
        const zipFile = await zip.loadAsync(buffer);
        const pluginYmlFile = zipFile.file('plugin.yml');

        if (!pluginYmlFile) {
            throw new Error('plugin.yml not found in the JAR file.');
        }

        const pluginYmlContent = await pluginYmlFile.async('string');
        const pluginInfo = jsyaml.load(pluginYmlContent);
        pluginInfo.pluginName = pluginName;

        return pluginInfo;
    } catch (error) {
        console.error('Error reading plugin info from JAR:', error.message);
        throw error;
    }
}

module.exports = {
    getPluginInformation: (directoryPath) => getPluginInformation(directoryPath),
    parseManifest: (serverFilePath) => parseManifest(serverFilePath),
    createEulaFile: (directoryPath) => createEulaFile(directoryPath),
    updateServerPropertiesOnlineMode: (directoryPath, OnlineMode) => updateServerProperties(directoryPath, 'online-mode', OnlineMode),
    updateServerPropertiesLevelName: (directoryPath, levelName) => updateServerProperties(directoryPath, 'level-name', levelName),
    readServerProperties: (directoryPath) => readServerProperties(directoryPath),
};
