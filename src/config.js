export const config={
 tabletChannel:'1502336969605251102',courseChannel:'1502335151324004457',coursePanelChannel:'1555666755886784523', actionChannels:{plus:'1502335672361549874',minus:'1502335801143464076',awans:'1502335910220533830',degrad:'1502336014834860142',zwolnij:'1502336111446462717'},
 staff:'1295044894825381950',employee:'1465037223350243390',
 ranks:[{id:'1524197367325134878',name:'Rekrut'},{id:'1292911416264622202',name:'Nowicjusz'},{id:'1519069368602988817',name:'Pracownik'},{id:'1292911416285728789',name:'Starszy pracownik'},{id:'1292911416285728790',name:'Specjalista'},{id:'1519067835769294858',name:'Doświadczony Specjalista'},{id:'1292911416285728792',name:'Kierownik zmiany'}],
 plus:['1292911416264622197','1292911416264622196','1392281365072056350','1392281626813272187','1392281792148406353'],
 minus:['1292911416264622199','1292911416264622198'],leave:'1361046239994450090',logs:'1554530259481665656'
};
export const labels={zatrudnij:'🍔 Zatrudnienie',plus:'⭐ Plus',minus:'⚠️ Minus',awans:'📈 Awans',degrad:'📉 Degradacja',zwolnij:'📋 Zwolnienie',urlop:'🌴 Urlop',zdejmijurlop:'☀️ Zakończenie urlopu',kolo:'🎡 Koło nagród',kurs:'📚 Kurs #4'};
export function environment(env=process.env){
 for(const key of ['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID','DATABASE_URL'])if(!env[key])throw new Error('Uzupełnij zmienną '+key);
 for(const key of ['DISCORD_CLIENT_ID','DISCORD_GUILD_ID'])if(!/^\d{17,20}$/.test(env[key]))throw new Error('Nieprawidłowe '+key);
 if(env.DISCORD_GUILD_ID!=='1292911416248111247')throw new Error('To konfiguracja serwera BurgerShot. Sprawdź DISCORD_GUILD_ID.');
 const production=env.NODE_ENV==='production'||Boolean(env.RAILWAY_ENVIRONMENT_ID);
 const publicUrl=env.PUBLIC_URL?.replace(/\/$/,'')||(env.RAILWAY_PUBLIC_DOMAIN?'https://'+env.RAILWAY_PUBLIC_DOMAIN:'');
 if(publicUrl){const u=new URL(publicUrl);if(u.origin!==publicUrl||(production&&u.protocol!=='https:'))throw new Error('PUBLIC_URL musi być samym adresem HTTPS bez ścieżki.');}
 return {production,publicUrl,clientSecret:env.DISCORD_CLIENT_SECRET,port:Number(env.PORT||3000),token:env.DISCORD_TOKEN,clientId:env.DISCORD_CLIENT_ID,guildId:env.DISCORD_GUILD_ID,databaseUrl:env.DATABASE_URL};
}
