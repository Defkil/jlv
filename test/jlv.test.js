const { describe, it } = require('mocha');
const chai = require('chai');
const mock = require('mock-require');
const { join } = require('path');
const { homedir } = require('os');

let jlv = require('../src/jlv');

chai.should();
const testData = 'Lorem ipsum';
const testData2 = 'dolor sit';
// const testData3 = 'amet consetetur';

describe('JLV functions', () => {
  it('run(filePath, param, open)', async () => {
    mock('../src/helper', {
      openShell(openNew, filePath, param) {
        openNew.should.eq(true);
        filePath.should.eq(testData);
        param.should.eq(testData2);
      },
    });
    jlv = mock.reRequire('../src/jlv');
    await jlv.run(testData, testData2, true);
  });

  it('createLogFile(filesGlob, save)', () => {
    // todo: test
  });

  it('saveLogFile(src, dist)', async () => {
    mock('../src/helper', {
      copyFile(src, dist) {
        src.should.eq(testData);
        dist.should.eq(testData2);
      },
    });
    jlv = mock.reRequire('../src/jlv');
    await jlv.saveLogFile(testData, testData2);
  });

  it('backupConfig(backupPath)', async () => {
    mock('../src/helper', {
      copyFile(src, dist) {
        src.should.eq(join(homedir(), jlv.CONFIG_FILENAME));
        dist.should.eq(join(testData, jlv.CONFIG_FILENAME));
      },
    });
    jlv = mock.reRequire('../src/jlv');
    await jlv.backupConfig(testData);
  });

  it('resetConfig()', async () => {
    mock('../src/helper', {
      existFile(path) {
        path.should.eq(join(homedir(), jlv.CONFIG_FILENAME));
      },
      deleteFile(path) {
        path.should.eq(join(homedir(), jlv.CONFIG_FILENAME));
      },
    });
    jlv = mock.reRequire('../src/jlv');
    await jlv.resetConfig();
  });

  it('loadConfig(pathConfig)', () => {
    // todo: test
  });

  it('runTransformer(transformer, filePath), runTransformerPath(transformer, filePath)'
    + ', runTransformerNpm(transformer, filePath)', () => {
    // need to mock function inside runTransformer() to test the other transformer
    // todo: test
  });
});
