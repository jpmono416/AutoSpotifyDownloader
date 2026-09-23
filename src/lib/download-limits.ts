export const MAX_ZIP_PART_BYTES=45_000_000;
export const MAX_EXPORT_BYTES=180_000_000;
export const MAX_ZIP_PARTS=4;

export interface SizedFile<T=string>{value:T;size:number}
export interface ZipPlan<T=string>{parts:Array<Array<SizedFile<T>>>;oversized:Array<SizedFile<T>>;overTotal:Array<SizedFile<T>>;totalBytes:number}

/** Packs whole files only. Compression is not assumed, so the result is conservative. */
export function planZipParts<T>(files:Array<SizedFile<T>>):ZipPlan<T>{
  const parts:Array<Array<SizedFile<T>>>=[],oversized:Array<SizedFile<T>>=[],overTotal:Array<SizedFile<T>>=[];let acceptedTotal=0,current:Array<SizedFile<T>>=[],currentBytes=0;
  for(const file of files){
    if(file.size>MAX_ZIP_PART_BYTES){oversized.push(file);continue;}
    if(acceptedTotal+file.size>MAX_EXPORT_BYTES){overTotal.push(file);continue;}
    if(current.length&&currentBytes+file.size>MAX_ZIP_PART_BYTES){parts.push(current);current=[];currentBytes=0;}
    if(parts.length>=MAX_ZIP_PARTS){overTotal.push(file);continue;}
    current.push(file);currentBytes+=file.size;acceptedTotal+=file.size;
  }
  if(current.length&&parts.length<MAX_ZIP_PARTS)parts.push(current);
  return {parts,oversized,overTotal,totalBytes:acceptedTotal};
}
