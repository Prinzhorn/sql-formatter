import Tokenizer from 'src/lexer/Tokenizer';

describe('Tokenizer', () => {
  const tokenize = (sql: string) =>
    new Tokenizer({
      reservedCommands: ['FROM', 'WHERE', 'LIMIT', 'CREATE TABLE'],
      reservedSelect: ['SELECT'],
      reservedDependentClauses: ['WHEN', 'ELSE'],
      reservedSetOperations: ['UNION', 'UNION ALL'],
      reservedJoins: ['JOIN'],
      reservedFunctionNames: ['SQRT', 'CURRENT_TIME'],
      reservedKeywords: ['BETWEEN', 'LIKE', 'ON', 'USING'],
      stringTypes: ["''-qq"],
      identTypes: ['""-qq'],
    }).tokenize(sql, {});

  it('tokenizes whitespace to empty array', () => {
    expect(tokenize(' \t\n \n\r ')).toEqual([]);
  });

  it('tokenizes single line SQL tokens', () => {
    expect(tokenize('SELECT * FROM foo;')).toMatchSnapshot();
  });

  it('tokenizes multiline SQL tokens', () => {
    expect(tokenize('SELECT "foo\n bar" /* \n\n\n */;')).toMatchSnapshot();
  });
});
