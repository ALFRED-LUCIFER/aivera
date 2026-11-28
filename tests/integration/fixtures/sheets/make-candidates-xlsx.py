# Writes the synthetic 12-row candidate sheet as a minimal .xlsx (inline strings), the same rows as the CSV in
# tests/integration/src/sheet-import.test.ts. Synthetic cast only (docs/00-product/personas.md).
import sys, zipfile
from xml.sax.saxutils import escape

NAMES = ['Sara Al Qahtani', 'Arjun Menon', 'Layla Haddad', 'Daniel Novak', 'Priya Nair', 'Omar Al Suwaidi',
         'Maria Santos', 'Hessa Al Mazrouei', 'Karim Nasser', 'Rana Khoury', 'Anjali Iyer', 'Tarek Mansour']
rows = [['Full name', 'E-mail', 'Resume URL']] + [
    [n, n.lower().replace(' ', '.') + '@example.com', f"https://{n.split()[0].lower()}.credalent.example/cv.pdf"]
    for n in NAMES]

def cell(ref, v):
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(v)}</t></is></c>'

sheet_rows = ''.join(
    f'<row r="{i + 1}">' + ''.join(cell('ABC'[j] + str(i + 1), v) for j, v in enumerate(r)) + '</row>'
    for i, r in enumerate(rows))
files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Candidates" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{sheet_rows}</sheetData></worksheet>',
}
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    for name, body in files.items():
        z.writestr(zipfile.ZipInfo(name, (2026, 11, 28, 0, 0, 0)), body)
