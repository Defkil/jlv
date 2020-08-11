const glob = require('glob');
const { merge } = require('event-stream');
const tmp = require('tmp');
const { spawn } = require('child_process');
const fs = require('fs');

/** @module helper */

tmp.setGracefulCleanup();

/**
 * Parsing the glob and returns selected files
 *
 * @param {!string} data glob string for log files
 * @returns {Promise.<Array.<string>>} Array of selected paths
 */
function parseGlob(data) {
  return new Promise(((resolve, reject) => {
    glob(data, {}, (err, files) => {
      if (err !== null) reject(err); else resolve(files);
    });
  }));
}

/**
 * Merge multiple files to one file
 *
 * @param {!Array.<string>} inputPathList list of files
 * @param {!string} outputPath file path where the merged file will be saved
 * @returns {Promise} Promise for merging
 */
function mergeFiles(inputPathList, outputPath) {
  return new Promise((resolve, reject) => {
    const streams = [];
    inputPathList.forEach((path) => {
      streams.push(fs.createReadStream(path));
    });
    merge(streams).pipe(fs.createWriteStream(outputPath))
      .on('finish', () => { resolve(); })
      .on('error', (err) => { reject(err); });
  });
}

/**
 * Creates a temporary folder
 *
 * @returns {Promise.<string>} folder path
 */
function createTmpFolder() {
  return new Promise((resolve, reject) => {
    tmp.dir({ unsafeCleanup: true }, (err, path) => {
      if (err) reject(err);
      resolve(path);
    });
  });
}

/**
 * Open json-log-viewer
 *
 * @param {boolean=} openNew if true open json-log-viewer in a new console
 * @param {!string} filePath path to log file
 * @param {string=} param json-log-viewer parameter
 * @returns {Promise} Promise for the shell
 */
function openShell(openNew, filePath, param) {
  return new Promise((resolve) => {
    if (openNew) {
      const command = `./node_modules/json-log-viewer/src/index.js ${filePath} ${param}`;
      spawn('node', [command], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'inherit',
        shell: true,
      });
      resolve();
    } else {
      global.process.argv.slice = () => [filePath, ...param.split(' ')]; // overwrites param
      // without the timeout the file will be empty
      // nextTick dont work too
      setTimeout(() => {
        require('json-log-viewer');
        resolve();
      }, 0);
    }
  });
}

/**
 * Copy a file to a new location
 *
 * @param {!string} src path to file
 * @param {!string} dist path where to save the file
 * @returns {Promise} Promise for coping a file
 */
function copyFile(src, dist) {
  return new Promise((resolve, reject) => {
    fs.copyFile(src, dist, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
}

/**
 * Delete a file
 *
 * @param {!string} src path to file
 * @returns {Promise} Promise for deleting a file
 */
function deleteFile(src) {
  return new Promise((resolve, reject) => {
    fs.unlink(src, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
}

/**
 * Check if file exist
 *
 * @param {!string} src path to file
 * @returns {Promise.<boolean>} Promise returns true if file exist
 */
function existFile(src) {
  return new Promise((resolve) => {
    fs.access(src, fs.F_OK, (err) => {
      if (err) return resolve(false);
      return resolve(true);
    });
  });
}

module.exports = {
  parseGlob,
  createTmpFolder,
  mergeFiles,
  openShell,
  copyFile,
  deleteFile,
  existFile,
};
