import xlrd, json, re, os

wb = xlrd.open_workbook('ASET 30 OKTOBER 2026.xls')
s = wb.sheet_by_index(0)
datemode = wb.datemode

MONTHS = {
 'jan':1,'januari':1,'feb':2,'februari':2,'mar':3,'maret':3,'apr':4,'april':4,
 'mei':5,'may':5,'jun':6,'juni':6,'jul':7,'juli':7,'agu':8,'agustus':8,'aug':8,
 'sep':9,'september':9,'okt':10,'oktober':10,'oct':10,'nov':11,'november':11,'nop':11,
 'des':12,'desember':12,'dec':12
}

def parse_date(v):
    if v == '' or v is None:
        return ''
    if isinstance(v, (int,float)):
        try:
            y,m,d,h,mm,ss = xlrd.xldate_as_tuple(v, datemode)
            return f'{y:04d}-{m:02d}-{d:02d}'
        except Exception:
            return ''
    s = str(v).strip()
    if s=='':
        return ''
    # try "20 Des 2017" or "03 Agu 2010"
    m = re.match(r'^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$', s)
    if m:
        d = int(m.group(1)); monname = m.group(2).lower(); y = int(m.group(3))
        mon = MONTHS.get(monname[:3]) or MONTHS.get(monname)
        if mon:
            return f'{y:04d}-{mon:02d}-{d:02d}'
    # try d/m/y or d-m-y
    m2 = re.match(r'^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$', s)
    if m2:
        d=int(m2.group(1)); m=int(m2.group(2)); y=int(m2.group(3))
        return f'{y:04d}-{m:02d}-{d:02d}'
    # try ISO
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    return s

rows=[]
idx=0
for i in range(4, s.nrows-1):
    code = str(s.cell_value(i,0)).strip()
    if code=='':
        continue
    nama = str(s.cell_value(i,1)).strip().replace('\n',' ').replace('\r',' ')
    tipe = str(s.cell_value(i,2)).strip()
    noakun = s.cell_value(i,3)
    if isinstance(noakun,float):
        # keep as number-ish string? keep numeric
        noakun_str = str(int(noakun)) if noakun==int(noakun) else str(noakun)
    else:
        noakun_str = str(noakun).strip()
    harga = s.cell_value(i,4)
    try:
        harga = float(harga)
    except:
        harga = 0.0
    tglpakai = parse_date(s.cell_value(i,5))
    tglbeli = parse_date(s.cell_value(i,6))
    umur = str(s.cell_value(i,7)).strip()
    rasio = s.cell_value(i,8)
    try:
        rasio = float(rasio)
    except:
        rasio = 0.0
    metode = str(s.cell_value(i,9)).strip()
    idx+=1
    rows.append({
        'id': f'AST-{idx:05d}',
        'kode': code,
        'nama': nama,
        'tipe': tipe,
        'noAkun': noakun_str,
        'harga': harga,
        'tglPakai': tglpakai,
        'tglBeli': tglbeli,
        'umur': umur,
        'rasio': rasio,
        'metode': metode,
    })

base = os.path.dirname(__file__)
with open(os.path.join(base,'data.json'),'w',encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False)
with open(os.path.join(base,'data.js'),'w',encoding='utf-8') as f:
    f.write('window.SEED_DATA = ')
    json.dump(rows, f, ensure_ascii=False)
    f.write(';')
print('rows', len(rows))
print('sample', rows[0])
print('sample2', rows[5])