const { describe, it } = require('mocha');
const chai = require('chai');
const mock = require('mock-require');

let jlv = require('../src/jlv');

chai.should();
const testData = 'Lorem ipsum';
const testData2 = 'dolor sit';
const testData3 = 'amet consetetur';

describe('JLV functions', () => {
  it('run(filePath, param, open)', async () => {
    mock('../src/helper', {
      openShell(openNew, filePath, param) {
        openNew.should.eq(testData3);
        filePath.should.eq(testData);
        param.should.eq(testData2);
      },
    });
    jlv = mock.reRequire('../src/jlv');
    await jlv.run(testData, testData2, testData3);
  });

  it('createLogFile(filesGlob, save)', () => {
    // todo: test
  });

  it('backupConfig(backupPath)', () => {
    // todo: test
  });

  it('resetConfig()', () => {
    // todo: test
  });

  it('loadConfig(pathConfig)', () => {
    // todo: test
  });

  it('runTransformer(transformer, filePath)', () => {
    // todo: test
  });

  it('runTransformerPath(transformer, filePath)', () => {
    // todo: test
  });

  it('runTransformerNpm(transformer, filePath)', () => {
    // todo: test
  });
});
