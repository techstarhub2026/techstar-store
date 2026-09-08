"""Generate Appendix E of the specification from the canonical schema.sql,
so the printed DDL can never drift from the file engineers actually run."""
import html
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SQL = os.path.join(HERE, 'assets', 'schema.sql')
OUT = os.path.join(HERE, 'src', '23-appendix-e.html')

sql = open(SQL, encoding='utf-8').read()
tables = re.findall(r'CREATE TABLE (\w+)', sql)

parts = []
parts.append('<h1 class="part"><span class="num">Appendix E</span>Complete MySQL DDL</h1>')
parts.append(
    '<p>The executable schema for all <strong>%d tables</strong>, ordered so that no foreign '
    'key references a table that does not yet exist. It runs top to bottom against a clean '
    'MySQL 8.0 server. This listing is generated directly from '
    '<code>docs/assets/schema.sql</code>, which is the file engineers run &mdash; the document '
    'and the schema cannot drift apart.</p>' % len(tables)
)
parts.append('<p class="kv"><strong>Tables:</strong> ' +
             ' &middot; '.join('<code>%s</code>' % html.escape(t) for t in tables) + '</p>')
parts.append('<pre class="long">' + html.escape(sql) + '</pre>')

open(OUT, 'w', encoding='utf-8').write('\n'.join(parts))
print('wrote %s — %d tables, %.1f KB' % (OUT, len(tables), len(sql) / 1024.0))
