import { HttpError } from '../../shared/errors/HttpError'
import { integer, objectBody } from '../../shared/validation'

export function parseLogo(value: unknown) {
  const body = objectBody(value, ['version', 'dataUrl'])
  if (
    typeof body.dataUrl !== 'string' ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.dataUrl)
  ) {
    throw new HttpError(400, 'El logo debe ser una imagen PNG válida.')
  }
  const data = Buffer.from(body.dataUrl.slice('data:image/png;base64,'.length), 'base64')
  if (
    data.length < 45 ||
    data.length > 65536 ||
    data.toString('base64') !== body.dataUrl.split(',')[1] ||
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    data.toString('ascii', 12, 16) !== 'IHDR' ||
    data.readUInt32BE(8) !== 13 ||
    data.readUInt32BE(16) < 1 ||
    data.readUInt32BE(20) < 1 ||
    data.readUInt32BE(16) > 512 ||
    data.readUInt32BE(20) > 512 ||
    data.toString('ascii', data.length - 8, data.length - 4) !== 'IEND'
  ) {
    throw new HttpError(400, 'El logo debe ser PNG, de hasta 512 × 512 píxeles y 64 KB.')
  }
  return { data, version: integer(body.version, 1) }
}
