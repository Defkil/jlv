const { join, dirname } = require('path');
const { homedir } = require('os');
const fs = require('fs');
const {
  parseGlob, createTmpFolder, mergeFiles, openShell, copyFile, deleteFile, existFile,
} = require('./helper.js');

const TEMP_LOG_FILENAME = 'result.log';
const TEMP_TRANSFORMED_LOG_FILENAME = 'transformed_result.log';
const CONFIG_FILENAME = '.json-log-viewer';

/**
 * Run json-log-viewer with parameter in the same or a new tab
 *
 * @param {!string} filePath path to log file
 * @param {string=} param json-log-view parameter
 * @param {!boolean} open if true open json-log-viewer in a new console
 */
async function run(filePath, param, open) {
  await openShell(open, filePath, (param) || '');
}

/**
 * Merge multiple files and save it optional
 *
 * @param {!string} filesGlob glob string for log files
 * @returns {string} path to merged log file
 */
async function createLogFile(filesGlob) {
  const files = await parseGlob(filesGlob);
  const path = await createTmpFolder();
  const filePath = join(path, TEMP_LOG_FILENAME);
  await mergeFiles(files, filePath);
  return filePath;
}

/**
 * Save file to dist path
 *
 * @param {!string} src source file path
 * @param {!string} dist destination file path
 */
async function saveLogFile(src, dist) {
  await copyFile(src, dist);
}

/**
 * Copy old config to a new path
 *
 * @param {!string} backupPath path where config file will be saved
 * @returns {Promise} Promise for coping a file
 */
async function backupConfig(backupPath) {
  return await copyFile(join(homedir(), CONFIG_FILENAME), join(backupPath, CONFIG_FILENAME));
}

/**
 * Delete config file
 */
async function resetConfig() {
  const path = join(homedir(), CONFIG_FILENAME);
  if (await existFile(path)) await deleteFile(path);
}

/**
 * Load config from parameter or if parameter is empty loads from actual path
 *
 * @param {string=} pathConfig config to .json-log-viewer file
 */
async function loadConfig(pathConfig) {
  if (pathConfig && await existFile(pathConfig)) {
    await copyFile(pathConfig, join(homedir(), CONFIG_FILENAME));
  } else {
    const path = join(process.cwd(), CONFIG_FILENAME);
    if (await existFile(path)) {
      await copyFile(path, join(homedir(), CONFIG_FILENAME));
    }
  }
}

/**
 * Run transformer over a log file
 *
 * @param {!string} transformer string for require the transformer
 * @param {!string} filePath path to log file
 * @returns {Promise.<string>} path to merged log file
 */
async function runTransformer(transformer, filePath) {
  return new Promise((resolve) => {
    // eslint-disable-next-line import/no-dynamic-require
    const tf = require(transformer);
    const newFilePath = join(dirname(filePath), TEMP_TRANSFORMED_LOG_FILENAME);
    const stream = fs.createReadStream(filePath);
    const writeStream = fs.createWriteStream(newFilePath);
    tf(stream).pipe(writeStream).on('close', () => {
      resolve(newFilePath);
    });
  });
}

/**
 * Return transform promise from path
 *
 * @param {!string} transformer path to transform file
 * @param {!string} filePath path to log file
 * @returns {Promise} Transform promise
 */
function runTransformerPath(transformer, filePath) {
  return runTransformer(join(process.cwd(), transformer), filePath);
}

/**
 * Return transform promise from module name
 *
 * @param {!string} transformer name of transform module
 * @param {!string} filePath path to log file
 * @returns {Promise} Transform promise
 */
async function runTransformerNpm(transformer, filePath) {
  await loadConfig(require.resolve(`${transformer}/.json-log-viewer`));
  return runTransformer(transformer, filePath);
}

module.exports = {
  createLogFile,
  saveLogFile,
  run,
  backupConfig,
  resetConfig,
  loadConfig,
  runTransformerPath,
  runTransformerNpm,
};
