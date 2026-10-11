import { authenticate } from '../api/agenda/[[path]].js';
export async function onRequest(context){
  try{await authenticate(context.request,context.env);return context.next()}
  catch(error){return new Response('Acesso exclusivo do responsável. O login administrativo precisa estar configurado na Cloudflare.',{status:error.status||403,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
}