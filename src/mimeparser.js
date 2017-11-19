import MimeNode from './node'

export default function parse (chunk) {
  const root = new MimeNode()
  const lines = (typeof chunk === 'object' ? String.fromCharCode.apply(null, chunk) : chunk).split(/\r?\n/g)
  lines.forEach(line => root.writeLine(line))
  root.finalize()
  return root
}
