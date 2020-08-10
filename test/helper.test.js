const { describe, it } = require('mocha');
const chai = require('chai');
const mock = require('mock-require');

const should = chai.should();
const testData = 'Lorem ipsum';
const testData2 = 'dolor sit';

let helper = require('../src/helper');

describe('Helper functions', () => {
  describe('#parseGlob(data)', () => {
    it('test sample glob', (done) => {
      mock('glob', (data, options, cb) => {
        if (data) {
          cb(null, data);
        } else {
          cb(testData2);
        }
      });
      helper = mock.reRequire('../src/helper');

      helper.parseGlob(testData).then((data) => {
        data.should.eq(testData);
        helper.parseGlob(undefined).catch((err) => {
          err.should.eq(testData2);
          done();
        });
      });
    });
  });

  describe('#mergeFiles(inputPathList, outputPath)', () => {
    let actual = '0'; // 0 for success and 1 for error
    it('merge two temp files', (done) => {
      mock('event-stream', { // todo: that could be done better
        merge(data) {
          data[0][0].should.eq(actual); return {
            pipe(pipeData) {
              pipeData.should.eq(testData); return {
                on(msg, cb) {
                  if (data[0][0] === '0') cb();
                  return { on(msgErr, cbErr) { if (data[0][0] === '1') cbErr(testData); } };
                },
              };
            },
          };
        },
      });
      mock('fs', {
        createReadStream(data) { data.should.eq(actual); return [data]; },
        createWriteStream(data) { data.should.eq(testData); return data; },
      });
      helper = mock.reRequire('../src/helper');

      helper.mergeFiles([actual], testData).then((data) => {
        should.not.exist(data);
        actual = '1';
        helper.mergeFiles([actual], testData).catch((err) => {
          err.should.eq(testData);
          done();
        });
      });
    });
  });

  describe('#createTmpFolder()', () => {
    it('create folder', (done) => {
      let tmpCounter = 0;
      mock('tmp', {
        dir(opts, cb) {
          if (tmpCounter === 0) { tmpCounter = 1; cb(null, testData); } else cb(testData);
        },
        setGracefulCleanup() {},
      });
      helper = mock.reRequire('../src/helper');

      helper.createTmpFolder().then((data) => {
        data.should.eq(testData);
        helper.createTmpFolder().catch((err) => {
          err.should.eq(testData);
          done();
        });
      });
    });
  });

  describe('#openShell()', () => {
    it('open shell in a new console', (done) => {
      let called = false;
      mock('child_process', {
        spawn(program, command, options) {
          program.should.eq('node');
          command[0].should.eq(`./node_modules/json-log-viewer/src/index.js ${testData} ${testData2}`);
          options.cwd.should.eq(process.cwd());
          options.detached.should.eq(true);
          options.stdio.should.eq('inherit');
          options.shell.should.eq(true);
          called = true;
        },
      });
      helper = mock.reRequire('../src/helper');
      helper.openShell(true, testData, testData2).then(() => {
        called.should.eq(true);
        done();
      });
    });
    it('open shell in same console', (done) => {
      let called = false;
      mock('json-log-viewer', called = true);
      helper = mock.reRequire('../src/helper');
      helper.openShell(false, testData, testData2).then(() => {
        called.should.eq(true);
        process.argv.slice().should.eql(['Lorem ipsum', 'dolor', 'sit']);
        done();
      });
    });
  });

  describe('#copyFile(src, dist)', () => {
    it('copy file without and with error', (done) => {
      mock('fs', {
        copyFile(src, dist, cb) {
          if (src) {
            src.should.eq(testData);
            dist.should.eq(testData2);
            cb();
          } else cb(testData);
        },
      });
      helper = mock.reRequire('../src/helper');

      helper.copyFile(testData, testData2).then((data) => {
        should.not.exist(data);
        helper.copyFile(undefined, undefined).catch((err) => {
          err.should.eq(testData);
          done();
        });
      });
    });
  });

  describe('#deleteFile()', () => {
    it('check if file exist', (done) => {
      mock('fs', {
        unlink(src, cb) {
          if (src) {
            src.should.eq(testData);
            cb();
          } else cb(testData);
        },
      });
      helper = mock.reRequire('../src/helper');

      helper.deleteFile(testData).then((data) => {
        should.not.exist(data);
        helper.deleteFile(undefined).catch((err) => {
          err.should.eq(testData);
          done();
        });
      });
    });
  });

  describe('#existFile(src)', () => {
    it('check if file exist', (done) => {
      mock('fs', {
        access(src, options, cb) {
          if (src) {
            src.should.eq(testData);
            cb();
          } else cb(testData);
        },
      });
      helper = mock.reRequire('../src/helper');

      helper.existFile(testData).then((data) => {
        data.should.eq(true);
        helper.existFile(undefined).then((dataFail) => {
          dataFail.should.eq(false);
          done();
        });
      });
    });
  });
});
