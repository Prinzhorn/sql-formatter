import tokenTypes from './tokenTypes';
import Indentation from './Indentation';
import InlineBlock from './InlineBlock';
import Params from './Params';
import { maxLength, trimSpacesEnd } from '../utils';
import {
	isAnd,
	isAs,
	isBetween,
	isEnd,
	isFrom,
	isLimit,
	isReserved,
	isSelect,
	isTopLevel,
	Token,
} from './token';
import Tokenizer from './Tokenizer';
import type { FormatOptions } from '../sqlFormatter';
import { AliasMode, CommaPosition, KeywordMode, NewlineMode } from '../types';

export default class Formatter {
	cfg: FormatOptions & { tenSpace?: boolean };
	newline: FormatOptions['newline'];
	currentNewline: boolean;
	lineWidth: number;
	indentation: Indentation;
	inlineBlock: InlineBlock;
	params: Params;

	falseSpace: string;
	previousReservedToken: Token;
	withinSelect: boolean;
	tokens: Token[];
	index: number;

	/**
	 * @param {FormatOptions} cfg
	 *  @param {String} cfg.language
	 *  @param {String} cfg.indent
	 *  @param {Boolean} cfg.uppercase
	 *  @param {NewlineOptions} cfg.newline
	 * 		@param {NewlineMode} cfg.newline.mode
	 * 		@param {Integer} cfg.newline.itemCount
	 *  @param {Integer} cfg.lineWidth
	 *  @param {Integer} cfg.linesBetweenQueries
	 *  @param {ParamItems | string[]} cfg.params
	 */
	constructor(cfg: FormatOptions) {
		this.cfg = cfg;
		this.cfg.tenSpace =
			this.cfg.keywordPosition === KeywordMode.tenSpaceLeft ||
			this.cfg.keywordPosition === KeywordMode.tenSpaceRight;
		this.newline = cfg.newline;
		this.currentNewline = true;
		this.lineWidth = cfg.lineWidth;
		this.indentation = new Indentation(this.cfg.indent);
		this.inlineBlock = new InlineBlock(this.lineWidth);
		this.params = new Params(this.cfg.params);

		this.falseSpace = '​'; // uses zero-width space (&#8203; / U+200B)
		this.previousReservedToken = {} as Token;
		this.withinSelect = false;
		this.tokens = [];
		this.index = 0;
	}

	/**
	 * SQL Tokenizer for this formatter, provided by subclasses.
	 */
	tokenizer(): Tokenizer {
		throw new Error('tokenizer() not implemented by subclass');
	}

	/**
	 * Reprocess and modify a token based on parsed context.
	 *
	 * @param {Token} token The token to modify
	 * @return {Token} new token or the original
	 */
	tokenOverride(token: Token): Token {
		// subclasses can override this to modify tokens during formatting
		return token;
	}

	/**
	 * Formats whitespace in a SQL string to make it easier to read.
	 *
	 * @param {String} query The SQL query string
	 * @return {String} formatted query
	 */
	format(query: string): string {
		this.tokens = this.tokenizer().tokenize(query);
		const formattedQuery = this.getFormattedQueryFromTokens();
		const finalQuery = this.postFormat(formattedQuery);

		return finalQuery.replace(/^\n*/u, '').trimEnd();
	}

	postFormat(query: string) {
		if (this.cfg.tabulateAlias) {
			query = this.formatAliasPositions(query);
		}
		if (this.cfg.commaPosition !== CommaPosition.after) {
			query = this.formatCommaPositions(query);
		}

		return query;
	}

	formatCommaPositions(query: string) {
		// const trailingComma = /,$/;
		const lines = query.split('\n');
		let newQuery: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].match(/.*,$/)) {
				let commaLines = [lines[i]];
				// find all lines in comma-bound clause, + 1
				while (lines[i++].match(/.*,$/)) {
					commaLines.push(lines[i]);
				}

				if (this.cfg.commaPosition === CommaPosition.tabular) {
					commaLines = commaLines.map(commaLine => commaLine.replace(/,$/, ''));
					const commaMaxLength = maxLength(commaLines); // get longest for alignment
					commaLines = commaLines.map((commaLine, j) =>
						j < commaLines.length - 1 // do not add comma for last item
							? commaLine + ' '.repeat(commaMaxLength - commaLine.length) + ','
							: commaLine
					);
				} else if (this.cfg.commaPosition === CommaPosition.before) {
					const isTabs = this.cfg.indent.includes('\t'); // loose tab check
					commaLines = commaLines.map(commaLine => commaLine.replace(/,$/, ''));
					const whitespaceRegex = this.tokenizer().WHITESPACE_REGEX;
					commaLines = commaLines.map((commaLine, j) =>
						j // do not add comma for first item
							? commaLine.replace(
									whitespaceRegex,
									commaLine.match(whitespaceRegex)![1].replace(
										new RegExp((isTabs ? '\t' : this.cfg.indent) + '$'), // replace last two spaces in preceding whitespace with ', '
										(isTabs ? '    ' : this.cfg.indent).replace(/ {2}$/, ', ') // using 4 width tabs
									)
							  )
							: commaLine
					);
				}

				newQuery = [...newQuery, ...commaLines];
			}
			newQuery.push(lines[i]);
		}

		return newQuery.join('\n');
	}

	formatAliasPositions(query: string) {
		const lines = query.split('\n');

		let newQuery: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			// find SELECT rows with trailing comma, if no comma (only one row) - no-op
			if (lines[i].match(/SELECT/i)) {
				newQuery.push(lines[i]); // add select to new query

				let aliasLines = [lines[++i]];
				// get all lines in SELECT clause
				while (lines[i++].match(/.*,$/)) {
					aliasLines.push(lines[i]);
				}

				const splitLines = aliasLines
					.map(line => line.split(/(?<=[^\s]+) (AS )?(?=[^\s]+,?$)/i)) // break lines into alias with optional AS, and all preceding text
					.map(slugs => ({
						precedingText: slugs[0], // always first split
						alias: slugs.length > 1 ? slugs[slugs.length - 1] : undefined, // always last in split
						as: slugs.length === 3 ? slugs[1] : undefined, // 2nd if AS is present, else omitted
					}));

				const aliasMaxLength = maxLength(
					splitLines.map(({ precedingText }) => precedingText.replace(/\s*,\s*$/, '')) // get longest of precedingText, trim trailing comma for non-alias columns
				);
				aliasLines = splitLines.map(
					({ precedingText, as, alias }) =>
						precedingText +
						(alias
							? ' '.repeat(aliasMaxLength - precedingText.length + 1) + (as ?? '') + alias
							: '')
				);
				newQuery = [...newQuery, ...aliasLines];
			}
			newQuery.push(lines[i]);
		}

		return newQuery.join('\n');
	}

	getFormattedQueryFromTokens() {
		let formattedQuery = '';

		this.tokens.forEach((token: Token, index) => {
			this.index = index;

			token = this.tokenOverride(token);
			if (isReserved(token)) {
				this.previousReservedToken = token;
				if (token.type !== tokenTypes.RESERVED) {
					token = this.tenSpacedToken(token);
				}
				if (isTopLevel(token)) {
					this.withinSelect = isSelect(token);
				}
			}

			if (token.type === tokenTypes.LINE_COMMENT) {
				formattedQuery = this.formatLineComment(token, formattedQuery);
			} else if (token.type === tokenTypes.BLOCK_COMMENT) {
				formattedQuery = this.formatBlockComment(token, formattedQuery);
			} else if (token.type === tokenTypes.RESERVED_TOP_LEVEL) {
				this.currentNewline = this.checkNewline(index);
				formattedQuery = this.formatTopLevelReservedWord(token, formattedQuery);
			} else if (token.type === tokenTypes.RESERVED_TOP_LEVEL_NO_INDENT) {
				formattedQuery = this.formatTopLevelReservedWordNoIndent(token, formattedQuery);
			} else if (token.type === tokenTypes.RESERVED_NEWLINE) {
				formattedQuery = this.formatNewlineReservedWord(token, formattedQuery);
			} else if (token.type === tokenTypes.RESERVED) {
				if (!(isAs(token) && this.cfg.aliasAs === AliasMode.never)) {
					// do not format if skipping AS
					formattedQuery = this.formatWithSpaces(token, formattedQuery);
					this.previousReservedToken = token;
				}
			} else if (token.type === tokenTypes.OPEN_PAREN) {
				formattedQuery = this.formatOpeningParentheses(token, formattedQuery);
			} else if (token.type === tokenTypes.CLOSE_PAREN) {
				formattedQuery = this.formatClosingParentheses(token, formattedQuery);
			} else if (token.type === tokenTypes.PLACEHOLDER) {
				formattedQuery = this.formatPlaceholder(token, formattedQuery);
			} else if (token.value === ',') {
				formattedQuery = this.formatComma(token, formattedQuery);
			} else if (token.value === ':') {
				formattedQuery = this.formatWithSpaces(token, formattedQuery, 'after');
			} else if (token.value === '.') {
				formattedQuery = this.formatWithoutSpaces(token, formattedQuery);
			} else if (token.value === ';') {
				formattedQuery = this.formatQuerySeparator(token, formattedQuery);
			} else if (
				token.value === '[' ||
				(token.value === '`' && this.tokenLookAhead(2)?.value === '`')
			) {
				formattedQuery = this.formatWithSpaces(token, formattedQuery, 'before');
			} else if (
				token.value === ']' ||
				(token.value === '`' && this.tokenLookBehind(2)?.value === '`')
			) {
				formattedQuery = this.formatWithSpaces(token, formattedQuery, 'after');
			} else if (token.type === tokenTypes.OPERATOR && this.cfg.denseOperators) {
				formattedQuery = this.formatWithoutSpaces(token, formattedQuery);
			} else {
				if (this.cfg.aliasAs !== AliasMode.never) {
					formattedQuery = this.formatAliases(token, formattedQuery);
				}
				formattedQuery = this.formatWithSpaces(token, formattedQuery);
			}
		});
		return formattedQuery.replace(new RegExp(this.falseSpace, 'ugim'), ' ');
	}

	formatAliases(token: Token, query: string) {
		const prevToken = this.tokenLookBehind();
		const nextToken = this.tokenLookAhead();
		const asToken = { type: tokenTypes.RESERVED, value: this.cfg.uppercase ? 'AS' : 'as' };

		const missingTableAlias = // if table alias is missing and alias is always
			this.cfg.aliasAs === AliasMode.always &&
			token.type === tokenTypes.WORD &&
			prevToken?.value === ')';

		const missingSelectColumnAlias = // if select column alias is missing and alias is not never
			this.withinSelect &&
			token.type === tokenTypes.WORD &&
			(isEnd(prevToken) || // isAs(prevToken) ||
				(prevToken?.type === tokenTypes.WORD &&
					(nextToken?.value === ',' || isTopLevel(nextToken))));

		if (missingTableAlias || missingSelectColumnAlias) {
			return this.formatWithSpaces(asToken, query);
		}
		return query;
	}

	checkNewline = (index: number) => {
		if (
			this.newline.mode === NewlineMode.always ||
			this.tokens.some(({ type, value }) => type === tokenTypes.OPEN_PAREN && value.length > 1) // auto break on CASE statements
		) {
			return true;
		}
		if (this.newline.mode === NewlineMode.never) {
			return false;
		}
		const tail = this.tokens.slice(index + 1);
		const nextTokens = tail.slice(
			0,
			tail.findIndex(
				({ type }) =>
					type === tokenTypes.RESERVED_TOP_LEVEL ||
					type === tokenTypes.RESERVED_TOP_LEVEL_NO_INDENT ||
					type === tokenTypes.RESERVED_NEWLINE
			)
		);

		const numItems = nextTokens.reduce(
			(acc, { type, value }) => {
				if (value === ',' && !acc.inParen) {
					return { ...acc, count: acc.count + 1 };
				} // count commas between items in clause
				if (type === tokenTypes.OPEN_PAREN) {
					return { ...acc, inParen: true };
				} // don't count commas in functions
				if (type === tokenTypes.CLOSE_PAREN) {
					return { ...acc, inParen: false };
				}
				return acc;
			},
			{ count: 1, inParen: false } // start with 1 for first word
		).count;

		if (this.newline.mode === NewlineMode.itemCount) {
			return numItems > this.newline.itemCount!;
		}

		// calculate length if it were all inline
		const inlineWidth = `${this.tokens[index].whitespaceBefore}${
			this.tokens[index].value
		} ${nextTokens.map(({ value }) => (value === ',' ? value + ' ' : value)).join('')}`.length;

		if (this.newline.mode === NewlineMode.lineWidth) {
			return inlineWidth > this.lineWidth;
		} else if (this.newline.mode === NewlineMode.hybrid) {
			return numItems > this.newline.itemCount! || inlineWidth > this.lineWidth;
		}

		return true;
	};

	formatLineComment(token: Token, query: string) {
		return this.addNewline(query + this.show(token));
	}

	formatBlockComment(token: Token, query: string) {
		return this.addNewline(this.addNewline(query) + this.indentComment(token.value));
	}

	indentComment(comment: string) {
		return comment.replace(/\n[ \t]*/gu, '\n' + this.indentation.getIndent() + ' ');
	}

	formatTopLevelReservedWordNoIndent(token: Token, query: string) {
		this.indentation.decreaseTopLevel();
		query = this.addNewline(query) + this.equalizeWhitespace(this.show(token));
		return this.addNewline(query);
	}

	formatTopLevelReservedWord(token: Token, query: string) {
		this.indentation.decreaseTopLevel();

		query = this.addNewline(query);

		if (this.cfg.tenSpace) {
			if (this.tokenLookAhead()?.value !== '(') {
				this.indentation.increaseTopLevel();
			}
		} else if (!(this.tokenLookAhead()?.value === '(' && isFrom(token))) {
			this.indentation.increaseTopLevel();
		}

		query += this.equalizeWhitespace(this.show(token));
		if (this.currentNewline && !this.cfg.tenSpace) {
			query = this.addNewline(query);
		} else {
			query += ' ';
		}
		return query;
	}

	formatNewlineReservedWord(token: Token, query: string) {
		if (isAnd(token) && isBetween(this.tokenLookBehind(2))) {
			return this.formatWithSpaces(token, query);
		}

		if (this.cfg.tenSpace) {
			this.indentation.decreaseTopLevel();
		}
		return this.addNewline(query) + this.equalizeWhitespace(this.show(token)) + ' ';
	}

	// Replace any sequence of whitespace characters with single space
	equalizeWhitespace(string: string) {
		return string.replace(/\s+/gu, ' ');
	}

	// Opening parentheses increase the block indent level and start a new line
	formatOpeningParentheses(token: Token, query: string) {
		// Take out the preceding space unless there was whitespace there in the original query
		// or another opening parens or line comment
		const preserveWhitespaceFor = {
			[tokenTypes.OPEN_PAREN]: true,
			[tokenTypes.LINE_COMMENT]: true,
			[tokenTypes.OPERATOR]: true,
		};
		if (
			token.whitespaceBefore?.length === 0 &&
			!preserveWhitespaceFor[this.tokenLookBehind()?.type]
		) {
			query = trimSpacesEnd(query);
		}
		query += this.show(token);

		this.inlineBlock.beginIfPossible(this.tokens, this.index);

		if (!this.inlineBlock.isActive()) {
			this.indentation.increaseBlockLevel();
			query = this.addNewline(query);
		}
		return query;
	}

	// Closing parentheses decrease the block indent level
	formatClosingParentheses(token: Token, query: string) {
		if (this.inlineBlock.isActive()) {
			this.inlineBlock.end();
			return this.formatWithSpaces(token, query, 'after');
		} else {
			this.indentation.decreaseBlockLevel();
			query = this.addNewline(query);
			if (this.cfg.tenSpace) {
				query += this.cfg.indent;
			}
			return this.formatWithSpaces(token, query);
		}
	}

	formatPlaceholder(token: Token, query: string) {
		return query + this.params.get(token) + ' ';
	}

	// Commas start a new line (unless within inline parentheses or SQL "LIMIT" clause)
	formatComma(token: Token, query: string) {
		query = trimSpacesEnd(query) + this.show(token) + ' ';

		if (this.inlineBlock.isActive()) {
			return query;
		} else if (isLimit(this.previousReservedToken)) {
			return query;
		} else if (this.currentNewline) {
			return this.addNewline(query);
		} else if (this.currentNewline) {
			if (this.cfg.tenSpace) {
				return this.addNewline(query) + this.cfg.indent;
			}
			return this.addNewline(query);
		} else {
			return query;
		}
	}

	formatWithoutSpaces(token: Token, query: string) {
		return trimSpacesEnd(query) + this.show(token);
	}

	formatWithSpaces(token: Token, query: string, preserve: 'before' | 'after' | 'both' = 'both') {
		const before = preserve === 'after' ? trimSpacesEnd(query) : query;
		const after = preserve === 'before' ? '' : ' ';
		return before + this.show(token) + after;
	}

	formatQuerySeparator(token: Token, query: string) {
		this.indentation.resetIndentation();
		query = trimSpacesEnd(query);
		if (this.cfg.semicolonNewline) {
			query += '\n';
		}
		return query + this.show(token) + '\n'.repeat(this.cfg.linesBetweenQueries || 1);
	}

	// Converts token to string (uppercasing it if needed)
	show(token: Token) {
		if (
			isReserved(token) ||
			token.type === tokenTypes.OPEN_PAREN ||
			token.type === tokenTypes.CLOSE_PAREN
		) {
			return this.cfg.uppercase ? token.value.toUpperCase() : token.value.toLowerCase();
		} else {
			return token.value;
		}
	}

	addNewline(query: string) {
		query = trimSpacesEnd(query);
		if (!query.endsWith('\n')) {
			query += '\n';
		}
		return query + this.indentation.getIndent();
	}

	tenSpacedToken(token: Token) {
		const addBuffer = (string: String, bufferLength = 9) =>
			this.falseSpace.repeat(Math.max(bufferLength - string.length, 0));
		if (this.cfg.tenSpace) {
			let bufferItem = token.value; // store which part of keyword receives 10-space buffer
			let tail = [] as string[]; // rest of keyword
			const needsSplit = bufferItem.length >= 10 && bufferItem.includes(' '); // split for long keywords like INNER JOIN or UNION DISTINCT
			if (needsSplit) {
				[bufferItem, ...tail] = bufferItem.split(' ');
			}

			if (this.cfg.keywordPosition === KeywordMode.tenSpaceLeft) {
				bufferItem += addBuffer(bufferItem, needsSplit ? 10 : 9);
			} else {
				bufferItem = addBuffer(bufferItem, needsSplit ? 10 : 9) + bufferItem;
			}

			token.value = bufferItem + tail.join(' ');
		}
		return token;
	}

	tokenLookBehind(n = 1) {
		return this.tokens[this.index - n];
	}

	tokenLookAhead(n = 1) {
		return this.tokens[this.index + n];
	}
}
