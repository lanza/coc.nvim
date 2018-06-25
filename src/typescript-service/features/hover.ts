import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import {tagsMarkdownPreview} from '../utils/previewer'
import * as typeConverters from '../utils/typeConverters'
import {HoverProvider} from '../../provider'
import {
  TextDocument,
  Position,
  CancellationToken,
  Hover,
  MarkedString,
} from 'vscode-languageserver-protocol'

export default class TypeScriptHoverProvider implements HoverProvider {
  public constructor(private readonly client: ITypeScriptServiceClient) {}

  public async provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Hover | undefined> {
    const filepath = this.client.toPath(document.uri)
    if (!filepath) {
      return undefined
    }
    const args = typeConverters.Position.toFileLocationRequestArgs(
      filepath,
      position
    )
    try {
      const response = await this.client.execute('quickinfo', args, token)
      if (response && response.body) {
        const data = response.body
        return {
          contents: TypeScriptHoverProvider.getContents(data),
          range: typeConverters.Range.fromTextSpan(data)
        }
      }
    } catch (e) {
      // noop
    }
    return undefined
  }

  private static getContents(data: Proto.QuickInfoResponseBody):MarkedString[] {
    const parts = []

    if (data.displayString) {
      parts.push({language: 'typescript', value: data.displayString})
    }

    const tags = tagsMarkdownPreview(data.tags)
    parts.push(data.documentation + (tags ? '\n\n' + tags : ''))
    return parts
  }
}
