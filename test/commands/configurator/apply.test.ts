import {expect, test} from '@oclif/test'
import * as testutils from '../../utils'
import {CliUx} from '@oclif/core'
import * as config from '../../../src/lib/config'
import {color} from '@heroku-cli/color'
import * as sinon from 'sinon'

describe('configurator:apply', () => {
  const invalidConfigFile = testutils.writeConfig('some invalid data')
  const simpleConfigFile = testutils.writeConfig(testutils.SIMPLE_CONFIG)
  let sinonStub: any | null = null;

  beforeEach(() => sinonStub = null)

  test
  .command(['configurator:apply', '-f', 'non_existing_file.yml'])
  .catch(error => expect(error.message).to.contain('does not exist'))
  .it('should fail gracefully with a missing config file')

  test
  .command(['configurator:apply', '-f', invalidConfigFile.name])
  .catch(error => expect(error.message).to.contain(`Invalid configuration: ${invalidConfigFile.name}`))
  .it('should inform the user of invalid configuration')

  test
  .stdout()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get(/apps\/.*\/config-vars/).reply(200, {FOO: 'foo'})
    .patch(/apps\/.*\/config-vars/).reply(200)
  })
  .command(['configurator:apply', '-f', simpleConfigFile.name])
  .it('should apply the config successfully', ({stdout}) => {
    // TODO: more meaningful test. maybe regex parsing the table or even add json output support?
    expect(stdout).to.contain('Config successfully applied')
  })

  test
  .stdout()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => 'wrong')
  .nock('https://api.heroku.com', api => {
    api
    .get(/apps\/.*\/config-vars/).reply(200, {FOO: 'foo'})
  })
  .command(['configurator:apply', '-f', simpleConfigFile.name])
  .it('should let the user know when skipped due to input mismatch', ({stdout}) => {
    // TODO: more meaningful test. maybe regex parsing the table or even add json output support?
    expect(stdout).to.contain('Max attempts exceeded, skipping app_a')
  })

  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test_app', apps: {test: {config: {FOO: 'foo'}, remote_config: ['REMOTE']}}}))
  .nock('https://api.heroku.com', api => {
    api.get(/apps\/.*\/config-vars/).reply(200, {FOO: 'foo', REMOTE: 'bar'})
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml'])
  .it('should inform the user when configs match', ctx => {
    expect(ctx.stdout).to.contain('No diffs found, exiting.')
  })

  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test_app', apps: {test: {config: {}, remote_config: []}}}))
  .nock('https://api.heroku.com', api => {
    api.get(/apps\/.*\/config-vars/).reply(200, {})
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml'])
  .it('should report no diffs when loaded config is empty', ctx => {
    expect(ctx.stdout).to.contain('No diffs found, exiting.')
  })

  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({
      name: 'test_config',
      apps: {
        test_a: {config: {FOO: 'foo'}, remote_config: []},
        test_b: {config: {FOO: 'bar'}, remote_config: []},
      },
    })
  )
  .nock('https://api.heroku.com', api => {
    api.get(/apps\/.*\/config-vars/).reply(200, {FOO: 'foo'})
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml', '--app', 'test_a'])
  .it('should only apply diffs to targeted app matches expected config', ctx => {
    expect(ctx.stdout).to.contain('No diffs found, exiting.')
  })

  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test_notfound', apps: {not_found: {config: {FOO: 'bar'}, remote_config: []}}}))
  .nock('https://api.heroku.com', api => {
    api.get(/apps\/.*\/config-vars/).reply(404)
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml'])
  .catch(error => {
    expect(error.message).to.contain('HTTP Error 404')
  })
  .it('should error out when configured project doesn\'t exist in heroku')

  test
  .stdout()
  .stderr()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {test: {config: {FOO: 'bar'}, remote_config: []}}}))
  .command(['configurator:apply', '-f', 'doesnt_matter.yml', '-a', 'not_found'])
  .catch(err => expect(err.message).to.contain(`App ${color.app('not_found')} is not in configured apps`))
  .it('should let the user know when the targeted app doesnt exist')

  test
  .stdout()
  .stderr()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get(/apps\/.*\/config-vars/).reply(200, {FOO: 'foo'})
    .patch(/apps\/.*\/config-vars/).reply(500)
  })
  .command(['configurator:apply', '-f', simpleConfigFile.name])
  .it('should let the user know when patch fails', ({stderr}) => {
    expect(stderr).to.contain('Unable to apply config')
  })

  test
  .stdout()
  .stderr()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api.get(/apps\/.*\/config-vars/).reply(500, {FOO: 'foo'})
  })
  .command(['configurator:apply', '-f', simpleConfigFile.name])
  .catch(error => expect(error.message).to.contain('HTTP Error 500'))
  .it('should exit early if config read fails unexpectedly')

  test
  .stdout()
  .stderr()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get(/apps\/.*\/config-vars/).reply(200, {FOO: 'foo'})
    .patch(/apps\/.*\/config-vars/).reply(403)
  })
  .command(['configurator:apply', '-f', simpleConfigFile.name])
  .it('should let the user know when they dont have access', ({stderr}) => {
    // not sure this needs to be different than other errors
    expect(stderr).to.contain('Unable to apply config')
  })

  test
  .stdout()
  .stderr()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => 'test')
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {test: {config: {FOO: 'foo'}, remote_config: ['REMOTE']}}}))
  .nock('https://api.heroku.com', api => {
    api
    .get('/apps/test/config-vars').reply(200, {
      FOO: 'foo',
      REMOTE: 'remote',
      DELETE: 'bar'
    })
    .patch('/apps/test/config-vars', {DELETE: null}).reply(200)
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml'])
  .it('should delete the key not marked remote', ({stdout}) => {
    expect(stdout).to.contain('DELETE')
  })

  test
  .stdout()
  .stderr()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => 'test')
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {test: {config: {FOO: 'foo'}, remote_config: ['REMOTE']}}}))
  .nock('https://api.heroku.com', api => {
    api
    .get('/apps/test/config-vars').reply(200, {
      FOO: 'foo',
      REMOTE: 'remote',
      DELETE: 'bar'
    })
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml', '--nodelete'])
  .it('should not delete if run with nodelete', ({stdout}) => {
    expect(stdout).to.not.contain('DELETE')
  })

  test
  .stdout()
  .stderr()
  .stub(CliUx.ux, 'confirm', () => async () => true)
  .stub(CliUx.ux, 'prompt', () => async () => {
    // there's gotta be a better way to do this
    if (!sinonStub) {
      sinonStub = sinon.stub()
      sinonStub.onCall(0).returns('test_a').onCall(1).returns('test_b')
    }
    const rval = sinonStub()
    return Promise.resolve(rval)
  })
  .stub(config, 'load', () => testutils.mockLoad({
    name: 'test',
    apps: {
      test_a: {config: {FOO: 'bar'}, remote_config: ['REMOTE']},
      test_b: {config: {FOO: 'bar'}, remote_config: ['REMOTE']},
    }
  }))
  .nock('https://api.heroku.com', api => {
    api
    .get('/apps/test_a/config-vars').reply(200, {FOO: 'foo'})
    .get('/apps/test_b/config-vars').reply(200, {FOO: 'foo'})
    .patch('/apps/test_a/config-vars').reply(200)
    .patch('/apps/test_b/config-vars').reply(403)
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml'])
  .it('should warn the user when an error occurs but complete the rest', ({stdout, stderr}) => {
    expect(stdout).to.contain('Applying config for test_a\nConfig successfully applied') &&
    expect(stderr).to.contain(`Unable to apply config`)
  })
})
