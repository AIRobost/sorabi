import { defineConfig } from 'vite'

// 相対パスで出力する。GitHub Pages のようにサブディレクトリで公開しても、そのまま動く
export default defineConfig({ base: './' })
