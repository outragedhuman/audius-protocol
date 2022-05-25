import commonjs from '@rollup/plugin-commonjs'
import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'
import nodePolyfills from 'rollup-plugin-polyfill-node'
import alias from '@rollup/plugin-alias'
// import shim from 'rollup-plugin-shim'

import pkg from './package.json'

const extensions = ['.js', '.ts']

const commonConfig = {
  plugins: [
    commonjs({
      extensions,
      dynamicRequireTargets: [
        'data-contracts/ABIs/*.json',
        'eth-contracts/ABIs/*.json'
      ]
    }),
    babel({ babelHelpers: 'bundled', extensions }),
    json(),
    resolve({ extensions, preferBuiltins: true }),
    typescript()
  ],
  external: [
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.devDependencies),
    'ethereumjs-util',
    'ethereumjs-wallet',
    'ethers/lib/utils',
    'ethers/lib/index',
    'hashids/cjs'
  ]
}

// These need to be internal so they are polyfilled via `nodePolyfills`
const internal = [
  // '@audius/hedgehog',
  // 'cipher-base'
  'ethereumjs-wallet',
  'ethereumjs-util',
  'ethereumjs-tx',
  'eth-sig-util'
  // 'fs',
  // 'node-localstorage',
  // 'crypto',
  // 'web3',
  // 'esm',
  // 'ipfs-unixfs-importer',
  // 'stream',
  // 'interface-blockstore',
  // 'interface-store',
  // 'multiformats/cid'
]

// "browser": {
//   "fs": false,
//   "node-localstorage": false,
//   "crypto": false,
//   "web3": false,
//   "esm": false,
//   "ipfs-unixfs-importer": false,
//   "stream": false,
//   "interface-blockstore": false,
//   "interface-store": false,
//   "multiformats/cid": false
// },

// TODO: figure out how to achieve the `browser` field ignores in rollup

const browserSdkConfig = {
  plugins: [
    resolve({ browser: false, extensions, preferBuiltins: false }),
    commonjs({
      extensions,
      transformMixedEsModules: true,
      dynamicRequireTargets: [
        'data-contracts/ABIs/*.json',
        'eth-contracts/ABIs/*.json'
      ]
    }),
    alias({
      entries: [{ find: 'stream', replacement: 'stream-browserify' }]
    }),
    nodePolyfills(),
    // shim({
    //   web3: 'export default {}'
    // }),
    babel({ babelHelpers: 'bundled', extensions }),
    json(),
    typescript()
  ],
  external: [
    ...Object.keys(pkg.dependencies).filter((dep) => !internal.includes(dep)),
    ...Object.keys(pkg.devDependencies),
    'ethers/lib/utils',
    'ethers/lib/index',
    'hashids/cjs'
  ]
}

const commonTypeConfig = {
  plugins: [dts()]
}

export default [
  /**
   * SDK
   */
  {
    input: 'src/sdk/index.ts',
    output: [
      { file: pkg.main, format: 'cjs', exports: 'auto', sourcemap: true }
    ],
    ...browserSdkConfig
  },
  {
    input: './src/sdk/index.ts',
    output: [{ file: pkg.types, format: 'cjs' }],
    ...commonTypeConfig
  },

  /**
   * SDK bundled for a browser environment
   */
  // {
  //   input: 'src/sdk/index.ts',
  //   output: [
  //     { file: pkg.browser, format: 'cjs', exports: 'auto', sourcemap: true }
  //   ],
  //   ...browserSdkConfig
  // },

  /**
   * libs (deprecated)
   */
  {
    input: 'src/libs.js',
    output: [
      { file: pkg.libs, format: 'cjs', exports: 'auto', sourcemap: true }
    ],
    ...commonConfig
  },
  {
    input: './src/libsTypes.ts',
    output: [{ file: pkg.libsTypes, format: 'cjs' }],
    ...commonTypeConfig
  },

  /**
   * core (used for eager requests)
   */
  {
    input: 'src/core.ts',
    output: [
      { file: pkg.core, format: 'cjs', exports: 'auto', sourcemap: true }
    ],
    ...commonConfig
  },
  {
    input: './src/core.ts',
    output: [{ file: pkg.coreTypes, format: 'cjs' }],
    ...commonTypeConfig
  }
]
