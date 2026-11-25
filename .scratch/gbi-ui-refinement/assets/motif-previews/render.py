"""Render proposed motif permutations; Pillow is a temporary export tool, not an app dependency."""
from pathlib import Path
import re
import sys
sys.path.insert(0, '/tmp/gbi-png-tools')
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
TOKENS = (ROOT / 'web/tokens.css').read_text()
SCALE = 2
FONT = '/usr/share/fonts/truetype/dejavu/'
FAMILIES = [
    ('Capital', 'Current money and holdings', 'Net worth / portfolio / holdings',
     ['circle', 'quarter', 'square', 'quadrant'], {'circle':'slot4','quarter':'slot5','square':'ink','quadrant':'slot2'}),
    ('Plan', 'Targets and intended allocations', 'Goals / allocation / cash-flow plans',
     ['quarter', 'square', 'quadrant', 'circle'], {'circle':'slot2','quarter':'slot4','square':'slot5','quadrant':'ink'}),
    ('Measurement', 'Outcomes against time or intent', 'Performance / plan vs actual',
     ['square', 'quadrant', 'circle', 'quarter'], {'circle':'ink','quarter':'slot2','square':'slot4','quadrant':'slot5'}),
    ('Records', 'Source records and maintenance', 'Transactions / imports / prices',
     ['quadrant', 'circle', 'quarter', 'square'], {'circle':'slot5','quarter':'ink','square':'slot2','quadrant':'slot4'}),
]
def palette(dark):
    light, night = TOKENS.split('@media (prefers-color-scheme: dark)',1)
    p = dict(re.findall(r'--([\w-]+):\s*(#[\da-fA-F]+)',light))
    if dark: p.update(re.findall(r'--([\w-]+):\s*(#[\da-fA-F]+)',night))
    return p

def font(size, bold=False, serif=False):
    return ImageFont.truetype(FONT+('DejaVuSerif' if serif else 'DejaVuSans')+('-Bold' if bold else '')+'.ttf', size*SCALE)

def text(draw,xy,string,p,size=18,role='ink',bold=False,serif=False):
    draw.text(tuple(int(v*SCALE) for v in xy),string,fill=p[role],font=font(size,bold,serif))

def motif(image, x,y,size,family,p):
    d=ImageDraw.Draw(image)
    tile=size/2
    for index,shape in enumerate(family[3]):
        xx=(x+(index%2)*tile)*SCALE; yy=(y+(index//2)*tile)*SCALE; t=tile*SCALE
        colour=p[family[4][shape]]
        if shape=='circle': d.ellipse((xx+t*.16,yy+t*.16,xx+t*.84,yy+t*.84),fill=colour)
        elif shape=='square': d.rectangle((xx,yy,xx+t-1,yy+t-1),fill=colour)
        elif shape=='quarter':
            layer=Image.new('RGBA',(round(t),round(t)))
            ImageDraw.Draw(layer).ellipse((0,0,t*2,t*2),fill=colour)
            # A quarter-disc anchored at the lower-right corner.
            layer=layer.transpose(Image.Transpose.ROTATE_180)
            image.paste(layer,(round(xx),round(yy)),layer)
        else:
            layer=Image.new('RGBA',(round(t),round(t)))
            ImageDraw.Draw(layer).ellipse((-t*.7,-t*.7,t*.7,t*.7),fill=colour)
            image.paste(layer,(round(xx),round(yy)),layer)

def card(image,x,y,w,h,family,p,number):
    d=ImageDraw.Draw(image)
    box=tuple(round(z*SCALE) for z in (x,y,x+w,y+h))
    d.rectangle(box,fill=p['raised'],outline=p['base'],width=SCALE)
    d.line(((x*SCALE,y*SCALE),((x+w)*SCALE,y*SCALE)),fill=p['ink'],width=2*SCALE)
    text(d,(x+28,y+22),f'{number:02d}  {family[0]}',p,26,bold=True)
    text(d,(x+28,y+66),family[1],p,17,role='ink2')
    motif(image,x+28,y+114,204,family,p)
    # Small contextual header rendering, separate from the main construction study.
    d.rectangle(tuple(round(z*SCALE) for z in (x+278,y+126,x+w-28,y+202)),fill=p['tint-blue-faint'])
    text(d,(x+294,y+151),family[0],p,16,bold=True)
    motif(image,x+w-96,y+132,64,family,p)
    text(d,(x+278,y+226),'Compact section mark',p,14,role='muted')
    text(d,(x+28,y+h-48),family[2],p,16,role='ink2')

def render(dark):
    p=palette(dark)
    img=Image.new('RGB',(1520*SCALE,1040*SCALE),p['surface']); d=ImageDraw.Draw(img)
    text(d,(48,30),'A shared shape language. Four precise meanings.',p,32,serif=True)
    text(d,(48,86),'Motif proposal / Palette D / fixed shapes, positions and colour assignments',p,17,role='ink2')
    for index,family in enumerate(FAMILIES):
        card(img,48+(index%2)*728,142+(index//2)*418,696,390,family,p,index+1)
        single=Image.new('RGB',(1000*SCALE,720*SCALE),p['surface'])
        sd=ImageDraw.Draw(single)
        text(sd,(48,36),family[0],p,36,serif=True)
        text(sd,(48,96),family[1],p,20,role='ink2')
        motif(single,64,180,360,family,p)
        sd.rectangle((520*SCALE,208*SCALE,952*SCALE,304*SCALE),fill=p['tint-blue-faint'])
        text(sd,(540,241),family[0],p,19,bold=True)
        motif(single,864,224,64,family,p)
        text(sd,(520,332),'Compact section mark',p,17,role='muted')
        text(sd,(48,620),family[2],p,20,role='ink2')
        text(sd,(48,670),'Proposed semantic family / Palette D',p,15,role='muted')
        single.resize((1000,720),Image.Resampling.LANCZOS).save(HERE/f'{family[0].lower()}-{ "dark" if dark else "light"}.png')
    text(d,(48,998),'Approval study: meaning, geometry and colour. Decorative artwork stays outside charts and status indicators.',p,14,role='muted')
    img.resize((1520,1040),Image.Resampling.LANCZOS).save(HERE/f'comparison-{ "dark" if dark else "light"}.png')

if __name__ == '__main__':
    render(False)
    render(True)
    print('Rendered 10 PNG previews.')
