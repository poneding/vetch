import type { ReactNode } from 'react'

/**
 * Minimal Markdown renderer for GitHub release notes.
 * Supports headings, lists, paragraphs, links, inline code, and emphasis.
 */
export function renderSimpleMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  let listItems: string[] = []
  let paragraph: string[] = []
  let key = 0

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return
    }
    nodes.push(
      <p className="md-paragraph" key={`p-${key}`}>
        {renderInline(paragraph.join(' '))}
      </p>
    )
    key += 1
    paragraph = []
  }

  const flushList = () => {
    if (listItems.length === 0) {
      return
    }
    nodes.push(
      <ul className="md-list" key={`ul-${key}`}>
        {listItems.map((item) => (
          <li key={`li-${key}-${item}`}>{renderInline(item)}</li>
        ))}
      </ul>
    )
    key += 1
    listItems = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      flushList()
      flushParagraph()
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushList()
      flushParagraph()
      const level = heading[1]?.length ?? 1
      const text = heading[2] ?? ''
      const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5'
      nodes.push(
        <Tag className="md-heading" key={`h-${key}`}>
          {renderInline(text)}
        </Tag>
      )
      key += 1
      continue
    }

    const listMatch = trimmed.match(/^[-*+]\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1] ?? '')
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushList()
  flushParagraph()
  return nodes
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern =
    /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g
  let lastIndex = 0
  let match = pattern.exec(text)
  let index = 0

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    if (match[1] && match[2] && match[3]) {
      nodes.push(
        <a
          className="md-link"
          href={match[3]}
          key={`a-${index}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {match[2]}
        </a>
      )
    } else if (match[4] && match[5]) {
      nodes.push(
        <code className="md-code" key={`code-${index}`}>
          {match[5]}
        </code>
      )
    } else if (match[6] && match[7]) {
      nodes.push(<strong key={`strong-${index}`}>{match[7]}</strong>)
    } else if (match[8] && match[9]) {
      nodes.push(<em key={`em-${index}`}>{match[9]}</em>)
    }
    lastIndex = match.index + match[0].length
    index += 1
    match = pattern.exec(text)
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}
