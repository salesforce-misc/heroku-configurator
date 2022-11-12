import {expect, test} from '@oclif/test'
import * as testutils from '../../utils'
import {CliUx} from '@oclif/core'
import * as config from '../../../src/lib/config'

describe('configurator:apply', () => {
  const invalidConfigFile = testutils.writeConfig('some invalid data')
  const simpleConfigFile = testutils.writeConfig(testutils.SIMPLE_CONFIG)

  test
  .command(['configurator:apply', '-f', 'non_existing_file.yml'])
  .catch(error => expect(error.message).to.contain('no such file or directory'))
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
    .get(/apps\/.*\/config-vars/)
    .reply(200, {FOO: 'foo'})
    .patch(/apps\/.*\/config-vars/)
    .reply(200)
  })
  .command(['configurator:apply', '-f', simpleConfigFile.name])
  .it('should apply the config successfully', ({stdout}) => {
    // TODO: more meaningful test. maybe regex parsing the table or even add json output support?
    expect(stdout).to.contain('Config successfully applied')
  })

  async function mockLoad(config: Record<string, unknown>): Promise<config.RootConfigType | config.ExternalConfigType> {
    return Promise.resolve(<config.RootConfigType | config.ExternalConfigType>config);
  }

  test
  .stdout()
  .stub(config, 'load', () => mockLoad({name: 'test_app', apps: {test: {config: {FOO: 'foo'}}}}))
  .nock('https://api.heroku.com', api => {
    api
    .get(/apps\/.*\/config-vars/)
    .reply(200, {FOO: 'foo'})
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml'])
  .it('should inform the user when configs match', ctx => {
    expect(ctx.stdout).to.contain('No diffs found, exiting.')
  })

  test
  .stdout()
  .stub(config, 'load', () => mockLoad({
      name: 'test_config',
      apps: {
        test_a: {config: {FOO: 'foo'}},
        test_b: {config: {FOO: 'bar'}},
      },
    })
  )
  .nock('https://api.heroku.com', api => {
    api
    .get(/apps\/.*\/config-vars/)
    .times(2)
    .reply(200, {FOO: 'foo'})
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml', '--app', 'test_a'])
  .it('should only apply diffs to targeted app matches expected config', ctx => {
    expect(ctx.stdout).to.contain('No diffs found, exiting.')
  })

  test
  .stdout()
  .stub(config, 'load', () => mockLoad({name: 'test_notfound', apps: {not_found: {config: {FOO: 'bar'}}}}))
  .nock('https://api.heroku.com', api => {
    api
    .get(/apps\/.*\/config-vars/)
    .reply(404)
  })
  .command(['configurator:apply', '-f', 'doesnt_matter.yml'])
  .catch(error => expect(error.message).to.contain('App not_found doesn\'t exist'))
  .it('should error out when configured project doesn\'t exist in heroku')

  // TODO: test for patch borking
  // TODO: test for 500 when reading configs
})
