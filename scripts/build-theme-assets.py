from pathlib import Path
import json
r=Path(__file__).resolve().parents[1]
palettes=json.loads((r/'frontend/src/theme/palettes.json').read_text())
css=['/* Generated from palettes.json by scripts/build-theme-assets.py. */']
for mode in ['light','dark']:
 for k,v in palettes.items():
  primary,soft,link,sidebar,on=v[mode]
  selector=f':root[data-palette="{k}"]'+('.dark' if mode=='dark' else ':not(.dark)')
  vals={'primary':primary,'primary-strong':f'color-mix(in srgb, {primary} 88%, black)','selection-surface':soft,'selection-text':link,'selection-border':f'color-mix(in srgb, {primary} 32%, var(--color-border))','link':link,'sidebar':sidebar,'on-primary':on,'account-action':primary,'account-action-hover':f'color-mix(in srgb, {primary} 88%, black)','account-action-text':on,'chart-heading':link,'chart-link':link,'chart-money':link,'summary-text':link,'summary-surface':soft,'total-surface':soft,'total-border':'var(--color-selection-border)','accent':primary}
  vals['chart-detail'] = v['chartDetail'][mode]
  vals['sidebar-selected'] = v['sidebarLight']['selected'] if mode == 'light' else soft
  vals['sidebar-selected-text'] = v['sidebarLight']['text'] if mode == 'light' else link
  common=({'background':'#F5F7FA','surface':'#FFFFFF','surface-muted':'#F8FAFC','text':'#243448','text-secondary':'#65798E','border':'#DCE4ED','border-strong':'#BCCBDA','shell':'#FFFFFF'} if mode=='light' else {'background':'#101720','surface':'#18222E','surface-muted':'#1C2937','text':'#E2EAF4','text-secondary':'#A9B9CD','border':'#344254','border-strong':'#526378','shell':'#18222E'})
  vals.update(common); vals['chart-muted']='var(--color-text-secondary)'
  css.append(selector+' {\n'+''.join(f'  --color-{n}: {val};\n' for n,val in vals.items())+'}')
(r/'frontend/src/theme/palettes.css').write_text('\n'.join(css)+'\n')
