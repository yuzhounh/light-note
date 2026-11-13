import 'fake-indexeddb/auto'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { db } from '../src/core/db/database.js'
import { cachedImageUrl, releaseImageUrls } from '../src/core/sync/imageCache.js'

after(() => { releaseImageUrls(); return db.delete() })
test('downloaded images reopen offline from persistent cache', async t => {
  let downloads = 0
  t.mock.method(globalThis, 'fetch', async () => {
    downloads++
    return new Response(new Blob(['image'], { type: 'image/png' }))
  })
  const src = 'https://lightnote.attachments/ab/hash.png'
  assert.match(await cachedImageUrl(src, 'user', async () => 'https://example.test/image'), /^blob:/)
  releaseImageUrls()
  assert.match(await cachedImageUrl(src, 'user', async () => { throw new Error('offline') }), /^blob:/)
  assert.equal(downloads, 1)
})

test('a full image cache still displays the downloaded image', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Blob(['image'], { type: 'image/png' })))
  t.mock.method(db.image_cache, 'put', async () => { throw new DOMException('full', 'QuotaExceededError') })
  assert.match(await cachedImageUrl('https://lightnote.attachments/ab/full.png', 'user', async () => 'https://example.test/full'), /^blob:/)
})
