// No pinch-to-zoom anywhere in the app (kiosk and phone pages). The CSS
// touch-action in index.css covers Chromium and Android; Safari on iOS
// ignores both it and user-scalable=no for pinching, so the gestures are
// also cancelled here. Ctrl+wheel (trackpad pinch on desktop) too.
export function disablePinchZoom(target = document) {
  const cancel = event => event.preventDefault()
  const multiTouch = event => {
    if (event.touches.length > 1) event.preventDefault()
  }
  const ctrlWheel = event => {
    if (event.ctrlKey) event.preventDefault()
  }
  const options = { passive: false }
  target.addEventListener('gesturestart', cancel, options)
  target.addEventListener('gesturechange', cancel, options)
  target.addEventListener('touchmove', multiTouch, options)
  target.addEventListener('wheel', ctrlWheel, options)
  return () => {
    target.removeEventListener('gesturestart', cancel, options)
    target.removeEventListener('gesturechange', cancel, options)
    target.removeEventListener('touchmove', multiTouch, options)
    target.removeEventListener('wheel', ctrlWheel, options)
  }
}
