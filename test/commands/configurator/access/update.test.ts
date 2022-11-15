import {expect, test} from '@oclif/test'
import {fancy} from 'fancy-test'
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
  .it('should apply updates successfully', ({stdout}) => {
    expect(stdout).to.contain('Permissions updates applied successfully')
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
  .catch((err) => expect(err.message).to.contain('must be a teams app'))
  .it('should should fail gracefully if an app isnt a teams app successfully')
})