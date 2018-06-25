import {Neovim} from 'neovim'
import {
  Placeholder,
} from './parser'
import {
  getChangeItem,
} from '../util/diff'
import Snippet from './snippet'
import workspace from '../workspace'
import Document from '../model/document'
import {
  DidChangeTextDocumentParams
} from 'vscode-languageserver-protocol'
const logger = require('../util/logger')('snippet-manager')

function onError(err):void {
  logger.error(err.stack)
}

export class SnippetManager {
  private snippet: Snippet
  private activted = false
  // zero indexed
  private startLnum: number
  private lineCount: number
  private uri: string
  private nvim: Neovim
  private currIndex = -1
  private changedtick: number

  public get isActivted():boolean {
    return this.activted
  }

  public init(nvim:Neovim):void {
    this.nvim = nvim
    workspace.onDidChangeTextDocument(this.onDocumentChange, this)
    workspace.onDidCloseTextDocument(textDocument => {
      if (textDocument.uri == this.uri) {
        this.detach().catch(onError)
      }
    })
  }

  public async attach():Promise<void> {
    let {snippet, document} = this
    if (!snippet || !document) return
    let linenr = await workspace.nvim.call('line', ['.']) as number
    this.startLnum = linenr - 1
    this.lineCount = document.lineCount
    let placeholder = snippet.firstPlaceholder
    if (placeholder) await this.jumpTo(placeholder)
    if (snippet.hasPlaceholder) {
      await this.nvim.call('coc#snippet#enable')
    }
    this.activted = true
  }

  public async detach():Promise<void> {
    if (!this.activted) return
    this.activted = false
    this.uri = ''
    if (!this.snippet.hasPlaceholder) return
    this.snippet = null
    try {
      await this.nvim.call('coc#snippet#disable')
    } catch (e) {
      onError(e)
    }
  }

  public get document():Document {
    return workspace.getDocument(this.uri)
  }

  private async onLineChange(content:string):Promise<void> {
    let {snippet, document} = this
    if (!document) return
    let text = snippet.toString()
    let change = getChangeItem(text, content)
    if (!change) return
    let [placeholder, start] = snippet.findPlaceholder(change, change.offset)
    if (!placeholder || placeholder.index == 0) {
      await this.detach()
      return
    }
    let newText = snippet.getNewText(change, placeholder, start)
    snippet.replaceWith(placeholder, newText)
    let {buffer} = document
    let line = snippet.toString()
    this.changedtick = document.changedtick
    if (line == content) return
    await buffer.setLines(line, {
      start: this.startLnum,
      strictIndexing: true
    })
  }

  public async insertSnippet(document: Document,line:number, newLine:string):Promise<void> {
    if (this.activted) await this.detach()
    try {
      let {buffer} = document
      this.uri = document.uri
      this.snippet = new Snippet(newLine)
      let str = this.snippet.toString()
      this.changedtick = document.changedtick
      await buffer.setLines(str, {
        start: line,
        strictIndexing: true
      })
    } catch (e) {
      logger.error(e.message)
    }
  }

  public async jumpTo(marker: Placeholder):Promise<void> {
    // need this since TextChangedP doesn't fire contentChange
    await this.ensureCurrentLine()
    let {snippet, nvim, startLnum} = this
    let offset = snippet.offset(marker)
    let col = offset + 1
    let len = marker.toString().length
    let choice = marker.choice
    if (choice) {
      let values = choice.options.map(o => o.value)
      await nvim.call('coc#snippet#show_choices', [startLnum + 1, col, len, values])
    } else {
      await nvim.call('coc#snippet#range_select', [startLnum + 1, col, len])
    }
    this.currIndex = marker.index
  }

  public async jumpNext():Promise<void> {
    let {currIndex, snippet} = this
    let {maxIndex} = snippet
    let valid = await this.checkPosition()
    if (!valid) return
    let idx:number
    if (currIndex == maxIndex) {
      idx = 0
    } else {
      idx = currIndex + 1
    }
    let {placeholders} = snippet.textmateSnippet
    let placeholder = placeholders.find(p => p.index == idx)
    this.currIndex = idx
    if (placeholder) await this.jumpTo(placeholder)
  }

  public async jumpPrev():Promise<void> {
    let {currIndex, snippet} = this
    let {maxIndex} = snippet
    let valid = await this.checkPosition()
    if (!valid) return
    let idx:number
    if (currIndex == 0) {
      idx = maxIndex
    } else {
      idx = currIndex - 1
    }
    let {placeholders} = snippet.textmateSnippet
    let placeholder = placeholders.find(p => p.index == idx)
    this.currIndex = idx
    if (placeholder) await this.jumpTo(placeholder)
  }

  public async checkPosition():Promise<boolean> {
    let lnum = await this.nvim.call('line', ['.'])
    if (lnum - 1 != this.startLnum) {
      await this.detach()
      return false
    }
    return true
  }

  /**
   * Check the real current line
   *
   * @private
   */
  private async ensureCurrentLine():Promise<void> {
    let {document, startLnum} = this
    if (!document) return
    let line = this.snippet.toString()
    let currline = document.getline(startLnum)
    if (line == currline) return
    await this.onLineChange(currline)
  }

  private onDocumentChange(e: DidChangeTextDocumentParams): void {
    let {startLnum, lineCount, document, uri, activted} = this
    let {textDocument} = e
    if (!activted || !document || uri !== textDocument.uri) return
    // line count change
    if (document.lineCount != lineCount) {
      this.detach().catch(onError)
      return
    }
    let newLine = document.getline(startLnum)
    let line = this.snippet.toString()
    // fired by snippet manager
    if (document.changedtick - this.changedtick == 1) return
    // other line change
    if (newLine == line) {
      this.detach().catch(onError)
      return
    }
    this.onLineChange(newLine).catch(onError)
  }
}

export default new SnippetManager()
