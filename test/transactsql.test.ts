import dedent from 'dedent-js';

import { format as originalFormat, FormatFn } from 'src/sqlFormatter';
import behavesLikeSqlFormatter from './behavesLikeSqlFormatter';

import supportsCreateTable from './features/createTable';
import supportsDropTable from './features/dropTable';
import supportsAlterTable from './features/alterTable';
import supportsStrings from './features/strings';
import supportsBetween from './features/between';
import supportsOperators from './features/operators';
import supportsJoin from './features/join';
import supportsConstraints from './features/constraints';
import supportsDeleteFrom from './features/deleteFrom';
import supportsComments from './features/comments';
import supportsIdentifiers from './features/identifiers';
import supportsParams from './options/param';
import supportsWindow from './features/window';
import supportsSetOperations from './features/setOperations';
import supportsLimiting from './features/limiting';
import supportsInsertInto from './features/insertInto';
import supportsUpdate from './features/update';
import supportsTruncateTable from './features/truncateTable';
import supportsMergeInto from './features/mergeInto';
import supportsCreateView from './features/createView';

describe('TransactSqlFormatter', () => {
  const language = 'transactsql';
  const format: FormatFn = (query, cfg = {}) => originalFormat(query, { ...cfg, language });

  behavesLikeSqlFormatter(format);
  supportsComments(format, { nestedBlockComments: true });
  supportsCreateView(format, { materialized: true });
  supportsCreateTable(format);
  supportsDropTable(format, { ifExists: true });
  supportsConstraints(format);
  supportsAlterTable(format, {
    dropColumn: true,
  });
  supportsDeleteFrom(format);
  supportsInsertInto(format, { withoutInto: true });
  supportsUpdate(format, { whereCurrentOf: true });
  supportsTruncateTable(format);
  supportsMergeInto(format);
  supportsStrings(format, ["N''", "''-qq"]);
  supportsIdentifiers(format, [`""-qq`, '[]']);
  supportsBetween(format);
  // Missing: `::` scope resolution operator (tested separately)
  supportsOperators(format, [
    '%',
    '&',
    '|',
    '^',
    '~',
    '!<',
    '!>',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '|=',
    '&=',
    '^=',
  ]);
  supportsJoin(format, { without: ['NATURAL'], supportsUsing: false, supportsApply: true });
  supportsSetOperations(format, ['UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT']);
  supportsParams(format, { named: ['@'], quoted: ['@""', '@[]'] });
  supportsWindow(format);
  supportsLimiting(format, { offset: true, fetchFirst: true, fetchNext: true });

  it('supports language:tsql alias', () => {
    const result = originalFormat('SELECT [my column] FROM [my table];', { language: 'tsql' });
    expect(result).toBe(dedent`
      SELECT
        [my column]
      FROM
        [my table];
    `);
  });

  it('recognizes @, $, # as part of identifiers', () => {
    const result = format('SELECT from@bar, where#to, join$me FROM tbl;');
    expect(result).toBe(dedent`
      SELECT
        from@bar,
        where#to,
        join$me
      FROM
        tbl;
    `);
  });

  it('allows @ and # at the start of identifiers', () => {
    const result = format('SELECT @bar, #baz, @@some, ##flam FROM tbl;');
    expect(result).toBe(dedent`
      SELECT
        @bar,
        #baz,
        @@some,
        ##flam
      FROM
        tbl;
    `);
  });

  it('formats scope resolution operator without spaces', () => {
    expect(format('SELECT hierarchyid :: GetRoot();')).toBe(dedent`
      SELECT
        hierarchyid::GetRoot ();
    `);
  });

  it('formats ALTER TABLE ... ALTER COLUMN', () => {
    expect(format(`ALTER TABLE t ALTER COLUMN foo INT NOT NULL DEFAULT 5;`)).toBe(dedent`
      ALTER TABLE
        t
      ALTER COLUMN
        foo INT NOT NULL DEFAULT 5;
    `);
  });
});
