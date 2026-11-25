"""Compare composition grammars using the same four primitives, without a four-tile grid."""
from render import HERE, SCALE, palette, text
from PIL import Image, ImageDraw

DIRECTIONS = [('A — Open balance','Space, unequal scale, one focal point'),
              ('B — Linear rhythm','A compact sequence with a clear baseline'),
              ('C — Architectural','Upright compositions with shared edges')]
ROWS = [('Plan','A target and the structure around it'),
        ('Measurement','A reference beside an observed outcome'),
        ('Records','Contained units and ordered entries')]
# Every composition uses exactly one circle, square, quarter-disc and small quadrant.
# Coordinates are within a 340 × 170 design field. Rotation applies only to quarter-disc shapes.
STUDIES = [
 [ [('square',40,50,86,0),('circle',226,10,60,0),('quarter',136,50,86,90),('quadrant',230,102,48,0)],
   [('square',40,70,70,0),('circle',138,24,112,0),('quarter',263,72,64,180),('quadrant',50,12,36,0)],
   [('square',135,20,94,0),('circle',46,88,66,0),('quarter',238,20,76,270),('quadrant',238,109,50,0)] ],
 [ [('circle',23,64,58,0),('square',103,38,84,0),('quarter',205,38,84,90),('quadrant',306,74,48,0)],
   [('square',15,64,58,0),('quarter',91,38,84,180),('circle',192,24,98,0),('quadrant',306,74,48,0)],
   [('quarter',15,38,84,270),('square',117,38,84,0),('quadrant',220,64,58,0),('circle',296,64,58,0)] ],
 [ [('quarter',120,4,76,90),('circle',202,34,44,0),('square',120,86,76,0),('quadrant',202,112,50,0)],
   [('circle',120,4,76,0),('quadrant',202,30,50,180),('quarter',120,86,76,270),('square',202,112,50,0)],
   [('square',120,4,76,0),('quarter',202,4,50,90),('quadrant',120,86,76,0),('circle',202,112,50,0)] ]
]

def shape(img,x,y,size,kind,rotation,p):
    t=round(size*SCALE)
    layer=Image.new('RGBA',(t,t))
    d=ImageDraw.Draw(layer)
    colour=p[{'circle':'slot4','square':'ink','quarter':'slot5','quadrant':'slot2'}[kind]]
    if kind=='circle': d.ellipse((0,0,t-1,t-1),fill=colour)
    elif kind=='square': d.rectangle((0,0,t-1,t-1),fill=colour)
    elif kind=='quarter': d.ellipse((0,0,t*2-1,t*2-1),fill=colour)
    else: d.ellipse((-t*.7,-t*.7,t*.7,t*.7),fill=colour)
    if rotation: layer=layer.rotate(rotation)
    img.paste(layer,(round(x*SCALE),round(y*SCALE)),layer)

def study(img,x,y,column,row,p,factor=1):
    for kind,xx,yy,size,rotation in STUDIES[column][row]:
        shape(img,x+xx*factor,y+yy*factor,size*factor,kind,rotation,p)

for dark in [False,True]:
    p=palette(dark); mode='dark' if dark else 'light'
    img=Image.new('RGB',(1580*SCALE,1180*SCALE),p['surface']); d=ImageDraw.Draw(img)
    text(d,(44,28),'Same shapes. Three different composition systems.',p,31,serif=True)
    text(d,(44,82),'Alternative proposals for Plan, Measurement and Records. Brand and Net worth artwork stay as approved.',p,16,role='ink2')
    for column,(name,detail) in enumerate(DIRECTIONS):
        x=44+column*508
        text(d,(x,136),name,p,24,bold=True)
        text(d,(x,178),detail,p,14,role='ink2')
        for row,(family,meaning) in enumerate(ROWS):
            y=222+row*292
            d.rectangle((x*SCALE,y*SCALE,(x+476)*SCALE,(y+270)*SCALE),fill=p['raised'],outline=p['base'],width=SCALE)
            text(d,(x+22,y+16),family,p,20,bold=True)
            text(d,(x+22,y+52),meaning,p,13,role='ink2')
            study(img,x+40,y+88,column,row,p)
        # An individual PNG for each complete direction.
        crop=img.crop((x*SCALE,126*SCALE,(x+476)*SCALE,1090*SCALE))
        crop.resize((476,964),Image.Resampling.LANCZOS).save(HERE/f'alternative-{chr(97+column)}-{mode}.png')
    text(d,(44,1130),'Circle = ochre / square = ink / quarter-disc = teal / small quadrant = peach. Meaning comes from the complete composition.',p,14,role='muted')
    img.resize((1580,1180),Image.Resampling.LANCZOS).save(HERE/f'alternatives-{mode}.png')
print('Rendered 8 alternative PNGs.')
