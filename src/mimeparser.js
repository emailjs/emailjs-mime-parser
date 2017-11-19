import MimeNode from './node'

export default function parse (chunk) {
  const parser = {}
  parser.bodystructure = ''
  parser.nodes = {}
  parser.root = new MimeNode(null, parser)

  const lines = (typeof chunk === 'object' ? String.fromCharCode.apply(null, chunk) : chunk).split(/\r?\n/g)
  lines.forEach(line => parser.root.writeLine(line))
  parser.root.finalize()
  return parser
}
