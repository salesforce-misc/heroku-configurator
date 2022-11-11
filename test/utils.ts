import {FileResult, fileSync as tmpFileSync} from 'tmp'
import {writeFileSync} from 'node:fs'

export const SIMPLE_CONFIG = `
name: simple-config
locals:
  shared_a:
    config:
      FOO: foo
  shared_b:
    config:
      BAR: bar
apps:
  app_a:
    include:
      - shared_a
      - shared_b
    config:
      BAZ: baz
`

export const INCLUDED_CONFIG = `
name: included_config
shared_a:
  config:
    BAR: bar
    BAZ: baz
`

export const INCLUDING_CONFIG = `
name: config_with_includes
include:
  - type: file
    params:
      path: <placeholder>
apps:
  app_a:
    include:
      - included_config.shared_a
    config:
      FOO: foo
      BAZ: foo
`

export const INVALID_CONFIG = `
foo: bar
`

export function writeConfig(data: string) : FileResult {
  const tmp = tmpFileSync()
  writeFileSync(tmp.name, data)
  return tmp
}
