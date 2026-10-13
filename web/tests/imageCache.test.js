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
