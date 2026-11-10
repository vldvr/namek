/** Сжимает выбранную картинку в квадрат 128×128 webp (обрезка по центру). */
export async function avatarFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not-image')
  const bitmap = await createImageBitmap(file)
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
  bitmap.close()
  for (const q of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/webp', q)
    if (url.length < 60_000) return url
  }
  return canvas.toDataURL('image/jpeg', 0.6)
}
