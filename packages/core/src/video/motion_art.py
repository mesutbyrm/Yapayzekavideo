#!/usr/bin/env python3
import argparse, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont
W, H = 720, 1280

def rgb(value, fallback):
    value=(value or fallback).strip().lstrip('#')
    if len(value)==3: value=''.join(ch*2 for ch in value)
    try: return tuple(int(value[i:i+2],16) for i in (0,2,4))
    except Exception: return fallback

def mix(a,b,t): return tuple(round(a[i]*(1-t)+b[i]*t) for i in range(3))
def rgba(c,a=255): return (*c,a)

def sphere(image, box, color, shadow=True):
    x0,y0,x1,y1=map(int,box); w=max(1,x1-x0); h=max(1,y1-y0)
    if shadow:
        sh=Image.new('RGBA',image.size,(0,0,0,0)); sd=ImageDraw.Draw(sh)
        sd.ellipse((x0+10,y1-8,x1+18,y1+22),fill=(0,0,0,135)); sh=sh.filter(ImageFilter.GaussianBlur(18)); image.alpha_composite(sh)
    layer=Image.new('RGBA',(w,h),(0,0,0,0)); px=layer.load()
    hi=mix(color,(255,255,255),0.62); lo=mix(color,(8,12,30),0.55)
    for y in range(h):
        for x in range(w):
            nx=(x/w-0.36)/0.72; ny=(y/h-0.28)/0.78; d=nx*nx+ny*ny
            if d<=1:
                light=max(0,min(1,1-math.sqrt(d)))
                c=mix(lo,hi,light*0.85)
                px[x,y]=rgba(c,255)
    image.alpha_composite(layer,(x0,y0))
    d=ImageDraw.Draw(image)
    d.ellipse((x0+w*.18,y0+h*.12,x0+w*.4,y0+h*.28),fill=(255,255,255,145))
    d.ellipse((x0+w*.3,y0+h*.22,x0+w*.36,y0+h*.27),fill=(255,255,255,110))

def rounded_gradient(image, box, top, bottom, radius=42, shadow=True):
    x0,y0,x1,y1=map(int,box); w=x1-x0; h=y1-y0
    if shadow:
        sh=Image.new('RGBA',image.size,(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle((x0+8,y0+16,x1+8,y1+26),radius,fill=(0,0,0,145)); image.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
    layer=Image.new('RGBA',(w,h),(0,0,0,0)); dr=ImageDraw.Draw(layer)
    for y in range(h): dr.line((0,y,w,y),fill=rgba(mix(top,bottom,y/max(1,h-1))),width=1)
    mask=Image.new('L',(w,h),0); ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius,fill=255)
    image.alpha_composite(Image.composite(layer,Image.new('RGBA',(w,h)),mask),(x0,y0))
    ImageDraw.Draw(image).rounded_rectangle((x0,y0,x1,y1),radius,outline=(255,255,255,130),width=3)

def draw_robot(image, accent):
    d=ImageDraw.Draw(image)
    d.line((260,655,205,730),fill=(155,185,255,255),width=38); d.line((460,655,515,730),fill=(155,185,255,255),width=38)
    d.line((315,810,290,885),fill=(155,185,255,255),width=48); d.line((405,810,430,885),fill=(155,185,255,255),width=48)
    sphere(image,(278,714,442,886),mix(accent,(255,255,255),.2))
    rounded_gradient(image,(220,430,500,680),(223,235,255),(112,137,220),62)
    d=ImageDraw.Draw(image); d.rounded_rectangle((248,465,472,625),42,fill=(12,19,51,255),outline=(255,255,255,180),width=4)
    for cx in (310,410):
        d.ellipse((cx-22,520-22,cx+22,520+22),fill=(115,245,255,255)); d.ellipse((cx-9,511,cx+5,525),fill=(255,255,255,255))
    d.rounded_rectangle((338,627,382,720),18,fill=(228,240,255,255)); d.ellipse((347,651,373,677),fill=rgba(accent))
    d.line((360,410,360,365),fill=(220,230,255,255),width=12); d.ellipse((342,338,378,374),fill=rgba(accent)); d.ellipse((350,342,362,354),fill=(255,255,255,230))

def draw_cat(image, accent):
    d=ImageDraw.Draw(image)
    d.arc((205,515,515,885),205,330,fill=(117,229,180,255),width=36)
    sphere(image,(205,575,515,805),(73,190,137))
    sphere(image,(270,420,470,630),mix(accent,(255,255,255),.08))
    d=ImageDraw.Draw(image)
    d.polygon([(284,468),(290,392),(343,449)],fill=(126,78,193,255),outline=(240,227,255,255)); d.polygon([(397,449),(451,392),(456,473)],fill=(126,78,193,255),outline=(240,227,255,255))
    d.polygon([(298,443),(302,412),(328,444)],fill=(255,141,174,255)); d.polygon([(414,444),(443,412),(447,451)],fill=(255,141,174,255))
    for x in (326,407):
        d.ellipse((x-13,492,x+13,527),fill=(250,252,255,255)); d.ellipse((x-6,497,x+7,523),fill=(28,38,75,255)); d.ellipse((x-3,498,x+2,505),fill=(255,255,255,255))
    d.polygon([(365,530),(379,530),(372,540)],fill=(255,126,170,255))
    d.arc((345,531,373,557),0,100,fill=(45,38,64,255),width=3); d.arc((371,531,399,557),80,180,fill=(45,38,64,255),width=3)
    for yy in (532,542,552):
        d.line((349,yy,270,yy-10),fill=(255,255,255,195),width=3); d.line((395,yy,472,yy-10),fill=(255,255,255,195),width=3)
    sphere(image,(220,747,300,835),(82,199,149),False); sphere(image,(422,747,502,835),(82,199,149),False)

def draw_turtle(image, accent):
    d=ImageDraw.Draw(image)
    for x,y in ((240,730),(475,730),(280,790),(435,790)):
        sphere(image,(x-40,y-25,x+40,y+65),(91,202,120),False)
    sphere(image,(215,540,505,785),(39,130,89))
    d=ImageDraw.Draw(image); d.ellipse((250,568,470,755),outline=(115,229,159,255),width=9)
    for bx,by in ((300,625),(370,605),(425,650),(350,700)):
        d.polygon([(350,660),(bx-33,by-18),(bx,by-43),(bx+38,by-12),(bx+25,by+28)],fill=(54,153,103,255),outline=(139,239,174,255))
    sphere(image,(430,590,555,700),(100,219,125),False); d=ImageDraw.Draw(image)
    d.ellipse((500,624,520,644),fill=(255,255,255,255)); d.ellipse((506,628,516,640),fill=(20,55,52,255))

def draw_documents(image, accent):
    d=ImageDraw.Draw(image)
    for i,(x,y,ang) in enumerate(((190,555,-10),(340,510,7),(265,700,3))):
        layer=Image.new('RGBA',(240,300),(0,0,0,0)); ld=ImageDraw.Draw(layer)
        ld.rounded_rectangle((25,25,215,270),16,fill=(0,0,0,105))
        ld.rounded_rectangle((14,12,204,257),16,fill=(249,247,255,255),outline=(255,255,255,255),width=4)
        ld.rounded_rectangle((35,42,180,58),8,fill=rgba(accent));
        for yy in (88,116,144,172,200): ld.rounded_rectangle((38,yy,177,yy+8),4,fill=(167,175,205,255))
        layer=layer.rotate(ang,Image.Resampling.BICUBIC,expand=False); image.alpha_composite(layer,(x,y))

def draw_game(image, accent):
    d=ImageDraw.Draw(image); rounded_gradient(image,(230,400,490,900),(255,93,202),(101,20,161),38)
    d=ImageDraw.Draw(image); d.rounded_rectangle((260,465,460,815),24,fill=(23,13,47,255),outline=(255,255,255,180),width=4)
    blocks=[(275,765,320,810,(250,78,163)),(322,765,367,810,(255,203,63)),(369,765,414,810,(75,224,255)),(414,720,459,765,(157,99,255)),(369,720,414,765,(250,78,163)),(322,720,367,765,(80,230,174))]
    for x,y,x2,y2,c in blocks:
        d.rounded_rectangle((x,y,x2,y2),8,fill=(*c,255),outline=(255,255,255,150),width=3); d.line((x+6,y+7,x2-7,y+7),fill=(255,255,255,130),width=3)

def draw_wolf(image, accent):
    d=ImageDraw.Draw(image); sphere(image,(220,570,500,800),(180,190,213)); sphere(image,(290,420,465,610),(210,218,235),False)
    d.polygon([(300,467),(286,380),(350,436)],fill=(165,178,208,255)); d.polygon([(404,438),(464,380),(449,486)],fill=(165,178,208,255))
    d.polygon([(320,442),(307,404),(340,436)],fill=(244,160,180,255)); d.polygon([(420,437),(451,403),(440,454)],fill=(244,160,180,255))
    for x in (337,410): d.ellipse((x-10,480,x+10,510),fill=(28,35,56,255))
    d.ellipse((365,525,412,555),fill=(245,247,255,255)); d.ellipse((376,532,402,547),fill=(35,39,55,255))
    for x in (260,465): sphere(image,(x-35,740,x+35,825),(165,178,208),False)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--out',required=True); ap.add_argument('--description',default=''); ap.add_argument('--primary',default='#5427d8'); ap.add_argument('--secondary',default='#0ea5e9'); ap.add_argument('--accent',default='#ffd83d'); ap.add_argument('--index',type=int,default=0); a=ap.parse_args()
    p=rgb(a.primary,(75,39,190)); s=rgb(a.secondary,(20,165,220)); ac=rgb(a.accent,(255,216,61)); txt=a.description.lower()
    im=Image.new('RGBA',(W,H),(8,13,33,255)); d=ImageDraw.Draw(im)
    for y in range(H):
        t=y/(H-1); c=mix(p,s,0.24+0.22*math.sin(t*math.pi)); c=mix(c,(11,15,42),max(0,(t-.55)*.65)); d.line((0,y,W,y),fill=rgba(c))
    glow=Image.new('RGBA',(W,H),(0,0,0,0)); gd=ImageDraw.Draw(glow); gd.ellipse((75,240,650,880),fill=rgba(mix(p,ac,.12),90)); im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(105)))
    rng=random.Random(a.index+871); bubbles=Image.new('RGBA',(W,H),(0,0,0,0)); bd=ImageDraw.Draw(bubbles)
    for _ in range(38):
        x=rng.randrange(20,W-20); y=rng.randrange(180,H-80); r=rng.randrange(5,35); bd.ellipse((x-r,y-r,x+r,y+r),fill=(255,255,255,rng.randrange(18,62)))
    im.alpha_composite(bubbles.filter(ImageFilter.GaussianBlur(5)))
    if any(k in txt for k in ('kaplumbağa','kaplumbaga','turtle')): draw_turtle(im,ac)
    elif any(k in txt for k in ('kedi','kedinin','cat','whisker')): draw_cat(im,ac)
    elif any(k in txt for k in ('kurt','wolf')): draw_wolf(im,ac)
    elif any(k in txt for k in ('oyun','game','tetris','kaybet')): draw_game(im,ac)
    elif any(k in txt for k in ('avukat','mahkeme','dava','court','hukuk','belge')): draw_documents(im,ac)
    else: draw_robot(im,ac)
    # A small 3D accent orb anchors the scene and adds a consistent motion-graphics language.
    sphere(im,(505,385,610,490),ac,True)
    im.convert('RGB').save(a.out,quality=95)
if __name__=='__main__': main()
