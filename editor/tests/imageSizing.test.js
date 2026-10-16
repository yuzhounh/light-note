import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultImageWidth, imageLayout, initialImageSize, presetImageSize } from '../src/imageSizing.js'

test('screenshots use 1080, tall phone images use 360, and small images are not enlarged', () => {
  assert.equal(defaultImageWidth(1920, 1080, 1.5), 1080)
  assert.equal(defaultImageWidth(1080, 2400, 2), 360)
  assert.equal(defaultImageWidth(1440, 2560, 2), 360)
  assert.equal(defaultImageWidth(320, 160, 2), 160)
})

test('preset percentages choose a fixed target from the image baseline', () => {
  assert.deepEqual(['25%', '50%', '75%', '100%'].map(preset => presetImageSize(1080, preset).width),
    ['270px', '540px', '810px', '1080px'])
  assert.equal(presetImageSize(360, '50%').width, '180px')
  const attrs = { ...initialImageSize(1920, 1080), ...presetImageSize(1080, '75%') }
  assert.equal(imageLayout(attrs, 1920, 1080, 2).width, '810px')
  assert.equal(imageLayout(attrs, 1920, 1080, 1).baseWidth, 1080)
  assert.equal(imageLayout({ baseWidth: 720, width: '540px' }).width, '540px')
})

test('old percentages use the new baseline while manual pixel widths survive', () => {
  assert.equal(imageLayout({ width: '75%' }, 1920, 1080).width, '810px')
  assert.equal(imageLayout({ width: '50%' }, 1080, 2400).width, '180px')
  assert.equal(imageLayout({ width: '327px' }, 1920, 1080).width, '327px')
})

test('existing default images follow the current default while adjusted widths stay fixed', () => {
  const oldDefault = { baseWidth: 720, width: '720px', widthPreset: '100%', pixelWidth: 2160, pixelHeight: 1080 }
  assert.equal(imageLayout(oldDefault, 0, 0, 1.5).width, '1080px')
  assert.equal(imageLayout({ ...oldDefault, pixelWidth: 1080, pixelHeight: 2400 }, 0, 0, 1.5).width, '360px')
  assert.equal(imageLayout({ ...oldDefault, width: '540px', widthPreset: '75%' }, 0, 0, 1.5).width, '540px')
  assert.equal(imageLayout({ ...oldDefault, widthMode: 'manual' }, 0, 0, 1.5).width, '720px')
  assert.equal(imageLayout({ width: '327px' }, 2160, 1080, 1.5).width, '327px')
  assert.equal(imageLayout({ width: '720px' }, 2160, 1080, 1.5).width, '720px')
})
