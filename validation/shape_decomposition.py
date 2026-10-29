# Prototype: rigid translation + offsets + creep template (pressure-shaped) least-squares fit
import json, sys, math, numpy as np
def fit(f, psic_deg):
    j=json.load(open(f)); g=j['geometry']
    if not g.get('displacedCenter'): return None
    c=np.array(g['originalCenter']); p=np.array(g['poleAxis']); p/=np.linalg.norm(p)
    R=g['commercialRadiusMm']
    t=np.array(g['displacedCenter'])-c; D=np.linalg.norm(t)
    if D<1e-6: return None
    u=t/D
    V=np.array(j['mesh']['vertices']).reshape(-1,3); d=V-c; r=np.linalg.norm(d,axis=1); n=d/r[:,None]
    dev=(r-R)*1000
    cu=n@u; worn=cu>0
    cc=math.cos(math.radians(psic_deg))
    S=np.where(cu>cc,(cu-cc)/(1-cc),0.0)             # pressure-shaped creep footprint, max 1
    cols=[n[:,0],n[:,1],n[:,2],                          # global centre error (all points)
          n[:,0]*worn,n[:,1]*worn,n[:,2]*worn,           # translation of the worn zone
          worn.astype(float),(~worn).astype(float),      # radius offsets of both zones
          S]
    A=np.stack(cols,1)
    # equal weight per solid angle: subsample to at most 60k points
    idx=np.random.default_rng(0).choice(len(dev),min(len(dev),60000),replace=False)
    A1,y=A[idx],dev[idx]
    coef,*_=np.linalg.lstsq(A1,y,rcond=None)
    res=y-A1@coef
    # block bootstrap over 15° patches about the pole for the creep coefficient
    th=np.degrees(np.arccos(np.clip(n[idx]@p,-1,1))); e1=np.cross(p,[1,0,0]); e1/=np.linalg.norm(e1); e2=np.cross(p,e1)
    az=np.degrees(np.arctan2(n[idx]@e2,n[idx]@e1))
    blk=(np.floor(th/15)*100+np.floor((az+180)/30)).astype(int)
    ub=np.unique(blk); rng=np.random.default_rng(1); bs=[]
    for b in range(150):
        pick=rng.choice(ub,len(ub)); m=np.concatenate([np.where(blk==k)[0] for k in pick])
        cb,*_=np.linalg.lstsq(A1[m],y[m],rcond=None); bs.append(cb[-1])
    return coef[-1], np.std(bs), np.sqrt(np.mean(res**2)), np.linalg.norm(coef[3:6]+coef[0:3])
for f in sys.argv[1:]:
    out=[]
    for pc in (50,65,80):
        r=fit(f,pc)
        if r is None: break
        out.append(f"ψc={pc}: a={r[0]:7.0f}±{r[1]:4.0f} rms={r[2]:5.0f}")
    if out: print(f[:22].ljust(22), ' | '.join(out))
