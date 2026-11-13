import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Capacitor } from '@capacitor/core'
import { downloadImageBlob, nativeImageBlob } from '../src/core/sync/imageDownload.js'

test('Android downloads binary images through native HTTP without browser CORS or URL re-encoding', async t => {
  t.mock.method(Capacitor, 'getPlatform', () => 'android')
  let request
  const nativeGet = async options => {
    request = options
    return { status: 200, headers: { 'Content-Type': 'image/png; charset=binary' }, data: 'iVBORw0KGgo=' }
  }
  t.mock.method(globalThis, 'fetch', () => { throw new Error('browser fetch blocked by CORS') })
  const url = 'https://firebasestorage.googleapis.com/v0/b/test/o/users%2Fu%2Fphoto.png?alt=media&token=test'
  const blob = await downloadImageBlob(url, nativeGet)
  assert.equal(request.url, url)
  assert.equal(request.responseType, 'arraybuffer')
  assert.equal(request.shouldEncodeUrlParams, false)
  assert.equal(blob.type, 'image/png')
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10])
})

test('native HTTP errors and non-image responses cannot become cached images', () => {
  assert.throws(() => nativeImageBlob({ status: 403, data: {} }), /403/)
  assert.throws(() => nativeImageBlob({ status: 200, headers: { 'content-type': 'application/json' }, data: '{}' }), /格式无效/)
  assert.throws(() => nativeImageBlob({ status: 200, headers: { 'content-type': 'image/png' }, data: '' }), /内容为空/)
})
