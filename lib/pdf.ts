import { getDocumentProxy } from "unpdf";
import { Problem, type Span, type Box } from "./types";

export const MAX_BYTES = 10 * 1024 * 1024;
type Cell = {text:string; box:Box};
function union(cells: Cell[]): Box {
  const x=Math.min(...cells.map(c=>c.box[0])), y=Math.min(...cells.map(c=>c.box[1]));
  return [x,y,Math.max(...cells.map(c=>c.box[0]+c.box[2]))-x,Math.max(...cells.map(c=>c.box[1]+c.box[3]))-y];
}

// Consecutive rows with matching column starts form a table. Keep the row location for citations.
export function layout(cells: Cell[], page: number): Span[] {
  const rows: Cell[][] = [];
  cells.sort((a,b)=>a.box[1]-b.box[1] || a.box[0]-b.box[0]);
  for (const cell of cells) {
    const row=rows.at(-1);
    if (row && Math.abs(row[0].box[1]-cell.box[1]) < Math.min(row[0].box[3],cell.box[3])*.45) row.push(cell);
    else rows.push([cell]);
  }
  const lines=rows.map(row=>{
    const cols: Cell[]=[];
    for(const c of row.sort((a,b)=>a.box[0]-b.box[0])) {
      const prev=cols.at(-1);
      if(prev && c.box[0]-prev.box[0]-prev.box[2]<0.027) {
        prev.text+=" "+c.text; prev.box=union([prev,c]);
      } else cols.push({...c});
    }
    return cols;
  });
  const out:Span[]=[];
  for(let i=0;i<lines.length;) {
    const first=lines[i]; let end=i+1;
    while(first.length>1 && end<lines.length && lines[end].length===first.length &&
      lines[end].every((c,j)=>Math.abs(c.box[0]-first[j].box[0])<.025)) end++;
    const table=end-i>=2;
    for(let r=i;r<end;r++) {
      const row=lines[r];
      let text=table?"| "+row.map(c=>c.text.replaceAll("|","\\|")).join(" | ")+" |":row.map(c=>c.text).join(" ");
      if(table && r===i) text+="\n| "+row.map(()=>"---").join(" | ")+" |";
      out.push({text,box:union(row),page});
    }
    i=end;
  }
  return out;
}

export async function readPdf(data: Uint8Array) {
  if (data.length > MAX_BYTES || !new TextDecoder().decode(data.slice(0,1024)).includes("%PDF-"))
    throw new Problem(400,"Choose a PDF up to 10 MB.");
  const pdf=await getDocumentProxy(data).catch(()=>{throw new Problem(422,"This PDF is damaged or password-protected.");});
  try {
    if(pdf.numPages>50) throw new Problem(422,"Choose a PDF with 50 pages or fewer.");
    const spans:Span[]=[]; let chars=0;
    for(let p=1;p<=pdf.numPages;p++) {
      const page=await pdf.getPage(p), view=page.getViewport({scale:1});
      const content=await page.getTextContent(), cells:Cell[]=[];
      for(const item of content.items) {
        if(!("str" in item) || !item.str.trim()) continue;
        const text=item.str.trim(); chars+=text.length;
        if(chars>450000) throw new Problem(422,"This PDF contains too much text for one indexing request.");
        const [a,b,c,d,e,f]=item.transform, sx=Math.hypot(a,b)||1, sy=Math.hypot(c,d)||1;
        const fontAscent=content.styles[item.fontName]?.ascent;
        const ascent=Number.isFinite(fontAscent)?fontAscent:.8;
        const points=[0,item.width].flatMap(u=>[ascent-1,ascent].map(v=>view.convertToViewportPoint(
          e+a/sx*u+c/sy*item.height*v, f+b/sx*u+d/sy*item.height*v)));
        const xs=points.map(pt=>Math.max(0,Math.min(1,pt[0]/view.width)));
        const ys=points.map(pt=>Math.max(0,Math.min(1,pt[1]/view.height)));
        cells.push({text,box:[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]});
      }
      spans.push(...layout(cells,p)); page.cleanup();
    }
    if(!spans.length) throw new Problem(422,"This PDF has no selectable text.");
    return {pages:pdf.numPages,spans};
  } finally { await pdf.loadingTask.destroy(); }
}
