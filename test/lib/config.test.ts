import {expect} from 'chai'

import {load, RootConfigType} from '../../src/lib/config'

import * as testutils from '../utils'
import * as path from 'path'

describe('config', () => {
  describe('#load()', (): void => {
    it('loads successfully', async (): Promise<void> => {
      const simpleConfigFile = testutils.writeConfig(testutils.SIMPLE_CONFIG)

      return (<Promise<RootConfigType>>load(simpleConfigFile.name))
      .then(conf => {
        expect(conf.apps.app_a.config).to.deep.equal({
          FOO: 'foo',
          BAR: 'bar',
          BAZ: 'baz',
        })
      })
    })

    it('errors out on invalid config', async (): Promise<void> => {
      const invalidConfig = testutils.writeConfig(testutils.INVALID_CONFIG)

      return load(invalidConfig.name)
      .then(() => {
        expect(false).to.be.true
      }).catch(() => {
        expect(true).to.be.true
      })
    })

    it('loads includes and flattens', async (): Promise<void> => {
      const includedTmpFile = testutils.writeConfig(testutils.INCLUDED_CONFIG)
      const includingTmpFile = testutils.writeConfig(
        testutils.INCLUDING_CONFIG.replace('<placeholder>', path.basename(includedTmpFile.name))
      )

      return (<Promise<RootConfigType>>load(includingTmpFile.name))
      .then(conf => {
        expect(conf.apps.app_a.config).to.deep.equal({
          FOO: 'foo',
          BAR: 'bar',
          BAZ: 'foo',
        })
      }).catch((err) => {
        console.log(err);
        expect(false).to.be.true
      })
    })
  })
})
