import { Token, TokenType } from 'src/lexer/token';
import { WHITESPACE_REGEX } from './regexUtil';

export interface TokenRule {
  regex: RegExp;
  key?: (token: string) => string;
  value?: (token: string) => string;
}

export default class TokenizerEngine {
  private rules: Partial<Record<TokenType, TokenRule>>;

  private input = ''; // The input SQL string to process

  private index = 0; // Current position in string

  constructor(rules: Partial<Record<TokenType, TokenRule>>) {
    this.rules = rules;
  }

  /**
   * Takes a SQL string and breaks it into tokens.
   * Each token is an object with type and value.
   *
   * @param {string} input - The SQL string
   * @returns {Token[]} output token stream
   */
  public tokenize(input: string): Token[] {
    this.input = input;
    this.index = 0;
    const tokens: Token[] = [];
    let token: Token | undefined;

    // Keep processing the string until end is reached
    while (this.index < this.input.length) {
      // skip any preceding whitespace
      const precedingWhitespace = this.getWhitespace();

      if (this.index < this.input.length) {
        // Get the next token and the token type
        token = this.getNextToken();
        if (!token) {
          throw new Error(`Parse error: Unexpected "${input.slice(this.index, 100)}"`);
        }

        tokens.push({ ...token, precedingWhitespace });
      }
    }
    return tokens;
  }

  private getWhitespace(): string | undefined {
    WHITESPACE_REGEX.lastIndex = this.index;

    const matches = WHITESPACE_REGEX.exec(this.input);
    if (matches) {
      // Advance current position by matched whitespace length
      this.index += matches[0].length;
      return matches[0];
    }
    return undefined;
  }

  private getNextToken(): Token | undefined {
    return (
      this.matchToken(TokenType.BLOCK_COMMENT) ||
      this.matchToken(TokenType.LINE_COMMENT) ||
      this.matchToken(TokenType.QUOTED_IDENTIFIER) ||
      this.matchToken(TokenType.NUMBER) ||
      this.matchToken(TokenType.CASE) ||
      this.matchToken(TokenType.END) ||
      this.matchToken(TokenType.BETWEEN) ||
      this.matchToken(TokenType.LIMIT) ||
      this.matchToken(TokenType.RESERVED_COMMAND) ||
      this.matchToken(TokenType.RESERVED_SELECT) ||
      this.matchToken(TokenType.RESERVED_SET_OPERATION) ||
      this.matchToken(TokenType.RESERVED_DEPENDENT_CLAUSE) ||
      this.matchToken(TokenType.RESERVED_JOIN) ||
      this.matchToken(TokenType.RESERVED_PHRASE) ||
      this.matchToken(TokenType.AND) ||
      this.matchToken(TokenType.OR) ||
      this.matchToken(TokenType.XOR) ||
      this.matchToken(TokenType.RESERVED_FUNCTION_NAME) ||
      this.matchToken(TokenType.RESERVED_KEYWORD) ||
      this.matchToken(TokenType.NAMED_PARAMETER) ||
      this.matchToken(TokenType.QUOTED_PARAMETER) ||
      this.matchToken(TokenType.NUMBERED_PARAMETER) ||
      this.matchToken(TokenType.POSITIONAL_PARAMETER) ||
      this.matchToken(TokenType.VARIABLE) ||
      this.matchToken(TokenType.STRING) ||
      this.matchToken(TokenType.IDENTIFIER) ||
      this.matchToken(TokenType.DELIMITER) ||
      this.matchToken(TokenType.COMMA) ||
      this.matchToken(TokenType.OPEN_PAREN) ||
      this.matchToken(TokenType.CLOSE_PAREN) ||
      this.matchToken(TokenType.OPERATOR) ||
      this.matchToken(TokenType.ASTERISK)
    );
  }

  // Shorthand for `match` that looks up regex from rules
  private matchToken(tokenType: TokenType): Token | undefined {
    const rule = this.rules[tokenType];
    if (!rule) {
      return undefined;
    }
    return this.match({
      type: tokenType,
      regex: rule.regex,
      transform: rule.value,
      transformKey: rule.key,
    });
  }

  // Attempts to match RegExp at current position in input
  private match({
    type,
    regex,
    transform,
    transformKey,
  }: {
    type: TokenType;
    regex: RegExp;
    transform?: (s: string) => string;
    transformKey?: (s: string) => string;
  }): Token | undefined {
    regex.lastIndex = this.index;
    const matches = regex.exec(this.input);
    if (matches) {
      const matchedToken = matches[0];

      const outToken: Token = {
        type,
        raw: matchedToken,
        text: transform ? transform(matchedToken) : matchedToken,
        start: this.index,
        end: this.index + matchedToken.length,
      };

      if (transformKey) {
        outToken.key = transformKey(outToken.text);
      }

      // Advance current position by matched token length
      this.index += matchedToken.length;
      return outToken;
    }
    return undefined;
  }
}
