import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerBackDismiss, dismissTopPopup } from '../src/hooks/useBackDismiss.js'

test('one back press closes only the highest visible popup, then the next popup', () => {
  const closed = []
  const removeSettings = registerBackDismiss(() => closed.push('settings'), 55)
  const removeHistory = registerBackDismiss(() => closed.push('history'), 60)
  assert.equal(dismissTopPopup(), true)
  assert.deepEqual(closed, ['history'])
  assert.equal(dismissTopPopup(), true)
  assert.deepEqual(closed, ['history', 'settings'])
  assert.equal(dismissTopPopup(), false)
  removeHistory(); removeSettings()
})

test('equally layered popups close newest first and removed popups cannot intercept back', () => {
  const closed = []
  const removeFirst = registerBackDismiss(() => closed.push('first'))
  const removeSecond = registerBackDismiss(() => closed.push('second'))
  assert.equal(dismissTopPopup(), true)
  assert.deepEqual(closed, ['second'])
  removeFirst(); removeSecond()
  assert.equal(dismissTopPopup(), false)
})
