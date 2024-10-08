import {expect, test} from '@oclif/test'
import * as config from '../../../../src/lib/config'
import * as testutils from '../../../utils'
import {CliUx} from '@oclif/core'

const ux = CliUx.ux;

describe('configurator:access:update', () => {
  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get(/teams\/apps\/.*\/collaborators/)
    .reply(200, [
      {
        app: {name: 'app_a'},
        permissions: [{name: 'view'}],
        user: {email: 'a@example.com'}
      }
    ])
    .post(/teams\/apps\/.*\/collaborators/).reply(200)
    .patch(/teams\/apps\/.*\/collaborators/).reply(200)
  })
  .command(['configurator:access:update', '-p', 'view,operate', '-f', 'doesnt_matter.yml', 'a@example.com,b@example.com'])
  .it('should apply updates (add) successfully', ({stdout}) => {
    expect(stdout).to.contain('Permissions updates applied successfully')
  })

  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get(/teams\/apps\/.*\/collaborators/)
    .reply(200, [
      {
        app: {name: 'app_a'},
        permissions: [{name: 'view'}, {name: 'operate'}],
        user: {email: 'a@example.com'}
      }
    ])
    .patch(/teams\/apps\/.*\/collaborators/).reply(200)
  })
  .command(['configurator:access:update', '-p', 'view', '-f', 'doesnt_matter.yml', 'a@example.com'])
  .it('should apply updates (removal) successfully', ({stdout}) => {
    expect(stdout).to.contain('Permissions updates applied successfully')
  })

  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'wrong')
  .nock('https://api.heroku.com', api => {
    api
    .get(/teams\/apps\/.*\/collaborators/)
    .reply(200, [
      {
        app: {name: 'app_a'},
        permissions: [{name: 'view'}],
        user: {email: 'a@example.com'}
      }
    ])
  })
  .command(['configurator:access:update', '-p', 'view,operate', '-f', 'doesnt_matter.yml', 'a@example.com,b@example.com'])
  .it('should skip when attempts have been exceeded', ({stdout}) => {
    expect(stdout).to.contain('Max attempts exceeded')
  })

  test
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}, app_b: {}}}))
  .nock('https://api.heroku.com', api => {
    api
    .get(/teams\/apps\/.*\/collaborators/)
    .times(2)
    .reply(404)
  })
  .command(['configurator:access:update', '-p', 'view', '-f', 'doesnt_matter.yml', 'a@example.com,b@example.com'])
  // these actually get reported in a more user-friendly way. the heroku cli error handling kicks in.
  .catch((err) => expect(err.message).to.contain('Error 404'))
  .it('should should fail gracefully if an app isnt a teams app')

  test
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .nock('https://api.heroku.com', api => {
    api
    .get(/teams\/apps\/.*\/collaborators/)
    .reply(403)
  })
  .command(['configurator:access:update', '-p', 'view', '-f', 'doesnt_matter.yml', 'a@example.com,b@example.com'])
  // these actually get reported in a more user-friendly way. the heroku cli error handling kicks in.
  .catch((err) => expect(err.message).to.contain('Error 403'))
  .it('should let the user know if they don\'t have access to view app permissions')

  test
  .stderr()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get('/teams/apps/app_a/collaborators')
    .reply(200, [{app: {name: 'app_a'}, permissions: [{name: 'view'}], user: {email: 'a@example.com'}}])
    .patch('/teams/apps/app_a/collaborators/a@example.com').reply(403)
  })
  .command(['configurator:access:update', '-p', 'view,operate', '-f', 'doesnt_matter.yml', 'a@example.com'])
  .it('should let the user know if they don\'t have access to update app permissions', ({stderr}) => {
    // these actually get reported in a more user-friendly way. the heroku cli error handling kicks in.
    expect(stderr).to.contain('HTTP Error 403 for PATCH')
  })

  test
  .stderr()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get('/teams/apps/app_a/collaborators')
    .reply(200, [{app: {name: 'app_a'}, permissions: [{name: 'view'}], user: {email: 'a@example.com'}}])
    .patch('/teams/apps/app_a/collaborators/a@example.com').reply(422)
  })
  .command(['configurator:access:update', '-p', 'view,operate', '-f', 'doesnt_matter.yml', 'a@example.com'])
  .it('should relay properly formatted errors back to the user', ({stderr}) => {
    expect(stderr).to.contain('HTTP Error 422')
  })

  test
  .stderr()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .command(['configurator:access:update', '-p', 'view,operate', '-f', 'doesnt_matter.yml', 'a@example.com', '-a', 'wrong_app'])
  .catch((err) => expect(err.message).to.contain('not in configured apps'))
  .it('should error out when an invalid app is specified')

  test
  .stderr()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}, app_b: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get('/teams/apps/app_a/collaborators')
    .reply(200, [{app: {name: 'app_a'}, permissions: [{name: 'view'}], user: {email: 'a@example.com'}}])
    .patch('/teams/apps/app_a/collaborators/a@example.com').reply(422)
  })
  .command(['configurator:access:update', '-p', 'view,operate', '-f', 'doesnt_matter.yml', 'a@example.com', '-a', 'app_a'])
  .it('should only update permissions for the specified app')

  test
  .stdout()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get('/teams/apps/app_a/collaborators')
    .reply(200, [{app: {name: 'app_a'}, permissions: [{name: 'view'}], user: {email: 'a@example.com'}}])
  })
  .command(['configurator:access:update', '-p', 'view', '-f', 'doesnt_matter.yml', 'a@example.com'])
  .it('should let the user know if there are no updates to be made', ({stdout}) => {
    expect(stdout).to.contain('No changes detected, exiting.')
  })

  test
  .stdout()
  .stderr()
  .stub(config, 'load', () => testutils.mockLoad({name: 'test', apps: {app_a: {}}}))
  .stub(ux, 'confirm', () => async () => 'y')
  .stub(ux, 'prompt', () => async () => 'app_a')
  .nock('https://api.heroku.com', api => {
    api
    .get('/teams/apps/app_a/collaborators')
    .reply(403)
  })
  .command(['configurator:access:update', '-p', 'view', '-f', 'doesnt_matter.yml', 'a@example.com'])
  .catch((err) => expect(err.message).to.contain('HTTP Error 403'))
  .it('should let the user know if they do not have access to view app permissions')
})