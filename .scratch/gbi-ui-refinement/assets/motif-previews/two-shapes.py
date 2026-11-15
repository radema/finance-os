"""Simple semantic studies: combine two primitives or repeat one. No four-piece kit."""
from render import HERE, SCALE, palette, text
from PIL import Image, ImageDraw

STUDIES = [
 ('Plan / 1', 'A target within a frame', 'One square + one circle', 'target'),
 ('Measurement / 1', 'Two things compared equally', 'Two circles', 'compare'),
 ('Records / 1', 'An ordered set of entries', 'One square, repeated three times', 'entries'),
 ('Plan / 2', 'Two parts forming one whole', 'Two quarter-discs', 'whole'),
 ('Measurement / 2', 'Actual within a reference', 'Two squares', 'reference'),
 ('Records / 2', 'A record and its copy', 'Two squares', 'copies'),
]

def artwork(kind,p,size=200):
    im=Image.new('RGBA',(size*SCALE,size*SCALE)); d=ImageDraw.Draw(im)
    def box(coords,fill=None,outline=None,width=1):
        d.rectangle(tuple(round(v*size*SCALE) for v in coords),fill=fill,outline=outline,width=max(1,round(width*size*SCALE)))
    def circle(coords,fill):
        d.ellipse(tuple(round(v*size*SCALE) for v in coords),fill=fill)
    if kind=='target':
        box((.12,.12,.88,.88),outline=p['slot5'],width=.085)
        circle((.33,.33,.67,.67),p['slot4'])
    elif kind=='compare':
        circle((.05,.27,.51,.73),p['slot2'])
        circle((.49,.27,.95,.73),p['slot5'])
    elif kind=='entries':
        for i,c in enumerate(['ink','slot4','slot5']):
            x=.08+i*.29
            box((x,.37,x+.23,.60),fill=p[c])
    elif kind=='whole':
        # Exactly two quarter-discs compose a semicircle on a common baseline.
        d.pieslice(tuple(round(v*size*SCALE) for v in (.12,.12,.88,.88)),180,270,fill=p['slot4'])
        d.pieslice(tuple(round(v*size*SCALE) for v in (.12,.12,.88,.88)),270,360,fill=p['slot5'])
    elif kind=='reference':
        box((.12,.12,.88,.88),outline=p['ink'],width=.035)
        box((.40,.40,.85,.85),fill=p['slot2'])
    elif kind=='copies':
        box((.12,.12,.66,.66),fill=p['slot5'])
        box((.34,.34,.88,.88),fill=p['slot4'])
    return im

for dark in [False,True]:
    p=palette(dark); mode='dark' if dark else 'light'
    img=Image.new('RGB',(1500*SCALE,1100*SCALE),p['surface']); d=ImageDraw.Draw(img)
    text(d,(44,30),'Two shapes. One clear relationship.',p,34,serif=True)
    text(d,(44,86),'Combine two primitives, or repeat one. Six candidates; the two approved main artworks stay untouched.',p,16,role='ink2')
    for index,(name,meaning,construction,kind) in enumerate(STUDIES):
        x=44+(index%3)*476; y=148+(index//3)*438
        d.rectangle((x*SCALE,y*SCALE,(x+444)*SCALE,(y+406)*SCALE),fill=p['raised'],outline=p['base'],width=SCALE)
        text(d,(x+24,y+20),name,p,22,bold=True)
        text(d,(x+24,y+60),meaning,p,16,role='ink2')
        art=artwork(kind,p)
        img.paste(art,((x+28)*SCALE,(y+104)*SCALE),art)
        mini=art.resize((64*SCALE,64*SCALE),Image.Resampling.LANCZOS)
        img.paste(mini,((x+322)*SCALE,(y+166)*SCALE),mini)
        text(d,(x+302,y+242),'Small size',p,13,role='muted')
        text(d,(x+24,y+354),construction,p,16,role='ink2')
    text(d,(44,1054),'Static identity marks, not data encodings. Proposed meanings are subject to your approval.',p,14,role='muted')
    img.resize((1500,1100),Image.Resampling.LANCZOS).save(HERE/f'two-shapes-{mode}.png')
print('Rendered light and dark two-shape studies.')
