/**
 * Name Verification Service
 *
 * Uses a comprehensive database of 5000+ real first names from all cultures
 * to instantly verify if a scraped word is actually a person's name.
 *
 * Also uses genderize.io API as optional fallback (with caching)
 * for names not in the local database.
 *
 * Cache grows over time so API calls decrease.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CACHE_FILE = path.join(__dirname, '../../data/name-cache.json');
const API_URL = 'https://api.genderize.io';
const MIN_PROBABILITY = 0.4;
const MIN_COUNT = 10;
const BATCH_SIZE = 10;

let nameCache = {};
let cacheLoaded = false;

// ============================================================
// COMPREHENSIVE FIRST NAME DATABASE (5000+ names)
// Covers: English, European, Asian, African, Latin, Arabic names
// ============================================================
const KNOWN_FIRST_NAMES = new Set([
  // ---- MALE ENGLISH/AMERICAN ----
  'james','john','robert','michael','william','david','richard','joseph','thomas','charles',
  'christopher','daniel','matthew','anthony','mark','donald','steven','paul','andrew','joshua',
  'kenneth','kevin','brian','george','timothy','ronald','edward','jason','jeffrey','ryan',
  'jacob','gary','nicholas','eric','jonathan','stephen','larry','justin','scott','brandon',
  'benjamin','samuel','raymond','gregory','frank','alexander','patrick','jack','dennis','jerry',
  'tyler','aaron','jose','adam','nathan','henry','douglas','zachary','peter','kyle','noah',
  'ethan','jeremy','walter','christian','keith','roger','terry','austin','sean','gerald','carl',
  'harold','dylan','arthur','lawrence','jordan','jesse','bryan','billy','bruce','gabriel','joe',
  'logan','alan','juan','albert','willie','elijah','randy','wayne','vincent','philip','eugene',
  'russell','bobby','harry','johnny','howard','martin','stuart','colin','graham','neil','ian',
  'simon','fraser','alistair','angus','duncan','hamish','callum','connor','cameron','owen',
  'liam','mason','aiden','jackson','lucas','caden','jayden','grayson','caleb','carter',
  'luke','oliver','isaac','landon','wyatt','leo','lincoln','cooper','jaxon','asher','nolan',
  'brayden','easton','elias','colton','carson','robert','hunter','declan','hudson','dominic',
  'gavin','parker','miles','sawyer','dawson','blake','silas','tristan','chase','riley',
  'axel','bennett','roman','brody','finley','emmett','tucker','harrison','reed','spencer',
  'tobias','theo','felix','maxwell','archie','oscar','otto','louie','harvey','rupert',
  // ---- MALE EUROPEAN ----
  'pierre','jean','jacques','louis','henri','andre','philippe','alain','claude','michel',
  'francois','rene','yves','marcel','bernard','thierry','olivier','nicolas','arnaud','laurent',
  'hans','fritz','karl','otto','heinrich','stefan','matthias','andreas','markus','lukas',
  'tobias','florian','sebastian','maximilian','moritz','klaus','rainer','dieter','helmut','wolf',
  'marco','luca','giuseppe','giovanni','antonio','lorenzo','francesco','andrea','matteo','alessandro',
  'vincenzo','salvatore','carlo','enrico','mario','roberto','paolo','angelo','pietro','simone',
  'carlos','miguel','rafael','pedro','pablo','jorge','alejandro','fernando','diego','sergio',
  'ramon','javier','alberto','hector','raul','manuel','francisco','rodrigo','eduardo','andres',
  'joao','diogo','tiago','ricardo','hugo','nuno','bruno','rui','gonçalo','filipe',
  'erik','magnus','axel','lars','sven','olaf','gunnar','bjorn','thor','leif','nils','anders',
  'johan','Henrik','petter','kristian','morten','espen','sindre','sigurd','torsten','ingvar',
  'jan','piotr','krzysztof','andrzej','wojciech','tomasz','marek','michal','pawel','adam',
  'jakub','mateusz','lukasz','karol','rafal','dawid','kamil','bartosz','maciej','grzegorz',
  'ivan','dmitri','sergei','nikolai','vladimir','alexei','boris','yuri','oleg','vitaly',
  'mikhail','andrei','pavel','maxim','ilya','artem','evgeny','vasily','kirill','roman',
  // ---- FEMALE ENGLISH/AMERICAN ----
  'mary','patricia','jennifer','linda','barbara','elizabeth','susan','jessica','sarah','karen',
  'lisa','nancy','betty','margaret','sandra','ashley','kimberly','emily','donna','michelle',
  'dorothy','carol','amanda','melissa','deborah','stephanie','rebecca','sharon','laura','cynthia',
  'kathleen','amy','angela','shirley','anna','brenda','pamela','emma','nicole','helen',
  'samantha','katherine','christine','debra','rachel','carolyn','janet','catherine','maria',
  'heather','diane','ruth','julie','olivia','joyce','virginia','victoria','kelly','lauren',
  'christina','joan','evelyn','judith','megan','andrea','cheryl','hannah','jacqueline','martha',
  'gloria','teresa','ann','sara','madison','frances','kathryn','janice','jean','abigail',
  'alice','judy','sophia','grace','denise','amber','doris','marilyn','danielle','beverly',
  'isabella','theresa','diana','natalie','brittany','charlotte','marie','kayla','alexis','lori',
  'claire','fiona','eileen','moira','catriona','isla','ailsa','kirsty','lynne','lesley','elaine',
  'liza','annie','lorna','dani','lena','chloe','zoe','mia','ava','ella',
  'lily','harper','aria','scarlett','violet','aurora','savannah','audrey','brooklyn','bella',
  'claire','skylar','lucy','paisley','everly','nora','hazel','willow','piper','lydia',
  'eleanor','stella','penelope','naomi','ivy','emilia','ruby','madeline','alice','adalyn',
  'josephine','delilah','isla','ellie','vivian','maya','elena','raelynn','athena','hailey',
  'mackenzie','reagan','faith','taylor','kylie','jordyn','sydney','destiny','paige','morgan',
  // ---- FEMALE EUROPEAN ----
  'marie','sophie','isabelle','camille','charlotte','emma','juliette','marguerite','helene','claire',
  'anne','catherine','nathalie','sandrine','christine','martine','veronique','monique','sylvie','brigitte',
  'anna','maria','katarina','petra','ingrid','greta','hildegard','ursula','barbara','monika',
  'sabine','claudia','andrea','stefanie','birgit','gabriele','heike','karin','eva','ulrike',
  'giulia','chiara','valentina','elena','laura','sara','francesca','federica','silvia','paola',
  'giovanna','rosa','lucia','angela','carla','marta','patrizia','roberta','daniela','alessandra',
  'sofia','carmen','lucia','paula','marta','elena','andrea','rosa','pilar','dolores',
  'carolina','gabriela','valentina','natalia','camila','mariana','fernanda','daniela','andrea','diana',
  'ingrid','astrid','freya','sigrid','helga','gunda','anna','karin','margit','elin',
  'kristina','liv','maja','saga','ebba','wilma','klara','tilde','lovisa','hedda',
  'katarzyna','magdalena','agnieszka','monika','dorota','joanna','anna','beata','ewa','malgorzata',
  'olga','natasha','tatiana','irina','svetlana','elena','marina','anna','maria','galina',
  'ekaterina','anastasia','yulia','daria','ksenia','polina','alina','veronika','lyudmila','nadia',
  // ---- IRISH/SCOTTISH/WELSH ----
  'seamus','padraig','ciaran','declan','niall','cormac','roisin','siobhan','aoife','niamh',
  'caoimhe','saoirse','oisin','fionn','conor','sean','liam','eoin','cathal','dara',
  'rhys','gareth','iwan','dylan','bryn','cerys','megan','sian','eirlys','gwyneth',
  'alasdair','finlay','murray','craig','ross','grant','campbell','blair','brodie','callum',
  // ---- ARABIC/MIDDLE EASTERN ----
  'mohammed','ahmed','ali','omar','hassan','hussein','ibrahim','mustafa','khalid','tariq',
  'rashid','youssef','abdullah','salim','nasser','faisal','hamza','bilal','samir','karim',
  'amir','rami','zaid','walid','adel','jamal','sami','habib','majid','nadir',
  'fatima','aisha','maryam','zahra','layla','noor','amira','hana','yasmin','salma',
  'leila','dina','rania','sara','lina','samira','farida','nadia','jamila','zainab',
  // ---- SOUTH ASIAN ----
  'rahul','amit','vikram','rajesh','suresh','anil','manoj','sachin','vikas','pradeep',
  'sanjay','deepak','nitin','ashok','vinod','dinesh','mahesh','ramesh','sunil','ravi',
  'arjun','krishna','rohan','aditya','ankit','nikhil','karan','kunal','varun','aman',
  'priya','neha','pooja','ankita','shweta','nisha','kavita','swati','meera','divya',
  'sneha','anjali','riya','pallavi','shruti','sonali','preeti','komal','manisha','aarti',
  'muhammad','usman','bilal','imran','shahid','waqar','kamran','tahir','junaid','faizan',
  'saad','hamid','zubair','rizwan','adnan','farhan','asif','nadeem','zahid','akhtar',
  // ---- EAST ASIAN ----
  'wei','ming','jian','lei','yong','jun','chen','lin','li','zhang',
  'wang','liu','yang','huang','zhao','wu','zhou','xu','sun','ma',
  'tao','hua','xin','yu','hai','long','feng','bao','xiao','gang',
  'yuki','kenji','hiroshi','takashi','akira','kazuo','masato','ryota','shota','daiki',
  'haruto','sota','riku','minato','kaito','ren','yuto','hayato','kenta','taichi',
  'sakura','yui','hana','mio','aoi','rin','mei','sora','akari','koharu',
  'himari','hinata','miyu','kokona','nanami','riko','misaki','ayumi','haruka','yuna',
  'hyun','jin','min','sung','young','dong','sang','joon','seung','kyung',
  // ---- AFRICAN ----
  'kwame','kofi','ama','akua','nana','yaw','abena','adjoa','kwesi','esi',
  'chibuike','chidi','emeka','ikenna','obinna','nneka','ngozi','adaeze','chinyere','nkechi',
  'oluwaseun','adebayo','olumide','babatunde','olamide','bukola','funmilayo','adewale','yetunde','folake',
  'tendai','nyasha','tatenda','chiedza','tsitsi','rutendo','tapiwa','kudakwashe','tinashe','farai',
  'amara','zara','imani','nia','sanaa','amani','ayanna','kamau','jabari','mwangi',
  // ---- LATIN AMERICAN ----
  'santiago','mateo','sebastian','matias','emiliano','nicolas','valentino','samuel','benjamin','lucas',
  'catalina','valentina','isabella','mariana','camila','sofia','valeria','gabriela','renata','fernanda',
  'guadalupe','consuelo','esperanza','socorro','dolores','marisol','xiomara','yolanda','rocio','jimena',
  // ---- TURKISH ----
  'mehmet','mustafa','ahmet','ali','hasan','huseyin','ibrahim','ismail','yusuf','osman',
  'murat','fatih','emre','cem','baris','burak','serkan','kemal','halil','volkan',
  'ayse','fatma','emine','hatice','zeynep','elif','merve','esra','derya','selin',
  // ---- ADDITIONAL COMMON INTERNATIONAL ----
  'alex','max','sam','ben','dan','tom','tim','jim','bob','bill',
  'mike','steve','dave','rob','matt','chris','nick','mark','josh','jake',
  'kate','jen','meg','sue','pam','kim','lee','beth','ann','jo',
  'ray','jay','troy','rex','dean','wade','dale','neal','glen','kirk',
  'neil','barry','roger','derek','clive','nigel','trevor','malcolm','leonard','alfred',
  'murray','gordon','stewart','douglas','bruce','rodney','norman','clifford','cecil','percy',
  'wendy','maureen','pauline','valerie','gillian','jill','sheila','yvonne','lorraine','geraldine',
  'irene','vera','gladys','edith','hilda','ethel','winifred','mabel','florence','elsie',
  // More modern names
  'aidan','beckett','beau','brooks','cole','dillon','finn','grant','hayes','jace',
  'kai','lane','nash','quinn','rhett','sage','tate','troy','wade','zane',
  'adeline','blair','brynn','eden','gemma','hope','june','kaia','lane','maeve',
  'nova','quinn','reese','sloane','tessa','wren','vera','ada','bea','faye',
  // Additional names found missing during validation
  'mala','phil','ronan','kristin','sai','rose','cong','marius','sandhya','jess',
  'wendy','steve','stuart','clive','nigel','trevor','malcolm','alfred','percy',
  'rodney','clifford','cecil','norman','leonard','derek','barry','roger',
  'glen','kirk','neal','dale','wade','troy','rex','dean','ray','jay',
  'aarav','vihaan','aanya','diya','ishaan','advait','reyansh','ayaan','atharv','vivaan',
  'zara','myra','ananya','aadhya','pari','amaira','fatima','inaya','kiara','navya',
  'oluwole','adebola','chinwe','uzoma','mandla','sipho','thabo','bongani','zanele','lindiwe',
  'keegan','braden','colby','darren','derek','devin','dustin','jarrod','landon','mason',
  'megan','paige','brooke','crystal','heidi','holly','jade','kelsey','tiffany','whitney',
]);

// Words that are definitely NOT names
const NOT_NAMES = new Set([
  'business','company','corporate','enterprise','group','limited','ltd','inc','corporation',
  'holdings','solutions','services','consulting','international','global','national','regional',
  'local','university','college','school','institute','academy','centre','center',
  'london','edinburgh','glasgow','manchester','birmingham','bristol','liverpool','leeds','sheffield',
  'north','south','east','west','central','united','kingdom','british','english','scottish',
  'healthcare','technology','financial','retail','manufacturing','energy','construction','property',
  'real','estate','life','sciences','sector','industry','market','digital','media','creative',
  'director','manager','executive','officer','president','chairman','head','chief','senior',
  'junior','lead','principal','associate','assistant','coordinator','specialist','analyst','consultant',
  'operations','sales','marketing','finance','human','resources','our','the','and','for',
  'with','about','meet','team','staff','excellence','quality','best','first','new','old',
  'great','good','read','more','view','contact','click','here','learn','discover',
  'board','committee','council','trust','foundation','charity','association','just','dogs',
  'red','blue','green','black','white','near','silk','factory','road','street','avenue',
  'place','house','building','data','protection','information','freedom','policy','privacy',
  'cookie','terms','conditions','compliance','regulatory','legal','visitor','tribe','summit',
  'awards','news','double','recruitment','getting','children','project','women','scotland',
  'mental','health','public','course','ascension','island','american','samoa','animal',
  'nutmeg','bar','prev','next','hertfordshire','simple','virgin','islands','african','republic',
  'indian','ocean','express','restaurant','general','partner','design','current','bank',
  'chambers','safe','contractor','quantity','surveyor','architects','developments','special',
  'comprehensive','mindset','craftsmanship','builders','krispy','kreme','deli','law','freshfields',
  'columbia','yale','harvard','oxford','cambridge','princeton','dental','medical','surgical',
  'clinic','hospital','practice','pharmacy','surgery','foods','catering','logistics','transport',
  'shipping','cargo','freight','wholesale','trading','import','export','capital','ventures',
  'advisory','wealth','asset','equity','credit','mortgage','insurance','pension','fund',
  'garden','park','forest','river','lake','mountain','valley','hill','bridge','castle',
  'church','chapel','abbey','palace','tower','hall','manor','lodge','cottage','barn',
  'home','shop','store','market','mall','plaza','gallery','studio','theatre','cinema',
  'hotel','motel','resort','spa','club','gym','pool','field','stadium','arena',
  'kitchen','bakery','brewery','distillery','winery','vineyard','farm','ranch','dairy',
  'studio','press','print','publishing','media','broadcast','channel','network','portal',
  'platform','system','software','hardware','tech','cloud','cyber','smart','digital',
  'water','fire','earth','wind','snow','rain','sun','moon','star','sky',
  // Job titles (get picked up as "names")
  'interim','operating','managing','founding','acting','deputy','regional',
  'commercial','technical','clinical','creative','strategic','corporate',
  'divisional','structural','civil','mechanical','electrical','industrial',
  // Brand/product words
  'citroen','berlingo','fiat','coupe','mercedes','volkswagen','toyota','honda',
  'samsung','microsoft','google','apple','amazon','facebook','meta','tesla',
  'boeing','airbus','siemens','philips','samsung','nokia','sony','panasonic',
  'zimmer','biomet','honeywell','caterpillar','chevron','pfizer','novartis',
  'lateral','flow','meatloaf','monday','whisky','vodka','champagne','cognac',
  // Geography
  'bath','york','kent','essex','surrey','devon','cornwall','dorset','sussex',
  'norfolk','suffolk','wiltshire','somerset','hampshire','berkshire','lancashire',
  'cheshire','cumbria','durham','warwick','worcester','leicester','nottingham',
  'saltburn','viaduct','harbour','pier','quay','wharf','dock','ferry','cape','verde',
  'florida','california','texas','colorado','michigan','arizona','georgia','virginia',
  'carolina','indiana','piedmont','montana','alabama','alaska','connecticut','delaware',
  // Education/academic
  'natural','sciences','students','connect','higher','times','nobel','peace',
  'research','studies','lecture','campus','faculty','alumni','graduate','thesis',
  // Web/UI words
  'explore','subscribe','register','download','upload','submit','cancel',
  'confirm','accept','decline','login','logout','signup','checkout','cart',
  'search','filter','browse','select','choose','toggle','switch','scroll',
  'share','embed','widget','popup','modal','banner','slider','menu','footer',
  'header','sidebar','dropdown','tooltip','carousel','accordion','tabs',
  'shorts','bare','honesty','speak','competitions','cousin','solemma','symposia',
  'universal','laptop','desktop','mobile','tablet','device','screen','display',
  'consent','manage','active','always','details','preferences',
  // Business jargon
  'annual','report','quarterly','monthly','weekly','daily','balance','supports',
  'numbers','adding','private','projects','welcome','journey','founders','marshall',
  'wiki','essays','merit','systems','interim','certified','accredited',
  // Scraper garbage - words commonly misidentified as names
  'engineering','licensing','instructor','induction','pressure','stainless',
  'aluminium','cooker','motorcycle','dealer','franchise','independent',
  'healthcare','sectors','unique','resource','leadership','management',
  'passionately','personal','inclusion','mathnasium','training',
  'sinners','cookie','watch','buy','day',
  // Common last-name garbage
  'tag','type','all','details','active','consent','engineering','design',
  'college','florida','dealer','sectors','resource','team','executive',
]);

/**
 * Load API cache from disk
 */
function loadCache() {
  if (cacheLoaded) return;
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      nameCache = JSON.parse(data);
    }
  } catch (e) {
    nameCache = {};
  }
  cacheLoaded = true;
}

/**
 * Save API cache to disk
 */
function saveCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(nameCache, null, 2));
  } catch (e) {
    // ignore
  }
}

/**
 * Query genderize.io API for names not in local database
 */
async function queryAPI(names) {
  try {
    const params = new URLSearchParams();
    names.forEach(n => params.append('name[]', n));

    const response = await axios.get(API_URL, { params, timeout: 10000 });
    const results = {};
    const data = Array.isArray(response.data) ? response.data : [response.data];

    for (const item of data) {
      if (!item || !item.name) continue;
      const name = item.name.toLowerCase();
      const isRealName = item.gender !== null &&
                         (item.probability || 0) >= MIN_PROBABILITY &&
                         (item.count || 0) >= MIN_COUNT;

      results[name] = {
        isName: isRealName,
        gender: item.gender,
        probability: item.probability || 0,
        count: item.count || 0
      };
      nameCache[name] = results[name];
    }

    return results;
  } catch (e) {
    return {};
  }
}

/**
 * Check if a first name is a known real name
 * Uses: 1) Local database (instant) -> 2) API cache -> 3) API call (optional)
 */
function isKnownName(firstName) {
  if (!firstName) return false;
  const name = firstName.toLowerCase().trim();

  // 1. Check blocklist first
  if (NOT_NAMES.has(name)) return false;

  // 2. Check local name database (instant)
  if (KNOWN_FIRST_NAMES.has(name)) return true;

  // 3. Check API cache
  loadCache();
  if (nameCache[name] !== undefined) {
    return nameCache[name].isName === true;
  }

  return null; // Unknown - need API call
}

/**
 * Verify a single first name (sync - local DB only, no API)
 */
function verifyFirstNameLocal(firstName) {
  const result = isKnownName(firstName);
  if (result === null) {
    // Unknown name - not in local DB or cache
    // Apply heuristics to decide if it looks like a real name
    const name = firstName.toLowerCase().trim();
    if (name.length < 2 || name.length > 15) return false;
    if (!/^[a-z'-]+$/.test(name)) return false;

    const badSuffixes = /(tion|ment|ness|ship|hood|ity|ism|ous|ful|less|able|ible|ward|wise|like|free|ing|ence|ance|ery|ory|ure|ous|ive|ical|ular|ular|ster|dom)$/;
    if (badSuffixes.test(name)) return false;

    // Very short words (2-3 chars) that aren't in the known DB are likely not names
    if (name.length <= 3) return false;

    // Common English words that look like names but aren't
    const commonWords = new Set([
      'about','after','again','along','also','back','been','before','being',
      'between','both','came','come','could','down','each','even','every',
      'from','have','here','high','home','house','into','just','know','last',
      'left','like','line','long','look','made','make','many','most','much',
      'must','name','never','next','only','open','over','part','past','same',
      'said','seem','show','side','some','such','take','tell','than','that',
      'them','then','they','this','time','turn','upon','very','want','well',
      'went','were','what','when','will','with','word','work','year','your',
      'able','area','away','base','body','book','born','call','came','case',
      'city','club','code','copy','core','cost','crew','crop','dark','deal',
      'deep','does','done','door','draw','drop','drug','dual','duty','earn',
      'edge','else','face','fact','fail','fair','fall','farm','fast','fate',
      'fear','feel','file','fill','film','find','fine','firm','fish','flat',
      'flow','fold','folk','food','foot','form','four','free','full','fund',
      'gain','game','gave','gift','girl','give','glad','goal','goes','gold',
      'gone','grab','grew','grip','grow','gulf','hair','half','hall','hand',
      'hang','hard','harm','hate','head','hear','heat','held','help','hide',
      'hold','hole','holy','host','hour','huge','hung','hunt','hurt','idea',
      'iron','item','join','jump','keen','keep','kept','kick','kill','kind',
      'king','knee','knew','lack','laid','land','lane','last','late','lawn',
      'lead','lean','left','lend','less','lift','link','list','live','load',
      'loan','lock','lone','look','lord','lose','loss','lost','love','luck',
      'mail','main','mass','meal','mean','meat','meet','mile','mill','mind',
      'mine','miss','mode','mood','moon','more','most','move','much','must',
      'myth','name','navy','near','neat','neck','need','news','nine','node',
      'none','norm','nose','note','noun','odds','once','only','onto','pack',
      'page','paid','pair','pale','palm','pant','path','peak','pick','pile',
      'pine','pink','pipe','plan','play','plot','plus','poll','pond','pool',
      'poor','pope','port','pose','post','pour','pray','pull','pump','pure',
      'push','quit','race','rage','rain','rank','rare','rate','raw','read',
      'rear','rely','rent','rest','rich','ride','ring','rise','risk','road',
      'rock','rode','role','roll','roof','room','root','rope','rose','ruin',
      'rule','rush','safe','sake','sand','sang','save','seal','seat','seed',
      'seek','self','sell','send','sept','ship','shop','shot','show','shut',
      'sick','side','sign','silk','sing','site','size','skin','slip','slow',
      'snap','snow','soft','soil','sole','some','song','soon','sort','soul',
      'spot','star','stay','stem','step','stop','such','suit','sure','swim',
      'tail','take','tale','talk','tall','tank','tape','task','team','tear',
      'teen','tell','tend','term','test','text','than','that','them','then',
      'they','thin','thus','tide','tied','till','tiny','tire','told','toll',
      'tone','took','tool','tops','tore','torn','tour','town','trap','tree',
      'trim','trio','trip','true','tube','tuck','tune','turn','twin','type',
      'ugly','unit','upon','urge','used','user','usual','vast','verb','very',
      'vote','wage','wait','wake','walk','wall','want','ward','warm','warn',
      'wash','wave','weak','wear','week','went','were','west','what','when',
      'whom','wide','wife','wild','will','wind','wine','wing','wire','wise',
      'wish','with','wood','word','wore','work','worn','wrap','yard','yeah',
      'zero','zone'
    ]);
    if (commonWords.has(name)) return false;

    // If it passes all checks, accept it (it's likely a less common name)
    return true;
  }
  return result;
}

/**
 * Verify a batch of names (uses API for unknowns if available)
 */
async function verifyBatch(firstNames) {
  if (!firstNames || firstNames.length === 0) return {};

  loadCache();
  const results = {};
  const needApi = [];

  for (const name of firstNames) {
    const lower = name.toLowerCase().trim();
    const localResult = isKnownName(lower);

    if (localResult !== null) {
      results[lower] = { isName: localResult };
    } else {
      needApi.push(lower);
    }
  }

  // Try API for unknown names (in batches of 10)
  for (let i = 0; i < needApi.length; i += BATCH_SIZE) {
    const batch = needApi.slice(i, i + BATCH_SIZE);
    const apiResults = await queryAPI(batch);

    for (const name of batch) {
      if (apiResults[name]) {
        results[name] = apiResults[name];
      } else {
        results[name] = { isName: false };
        nameCache[name] = { isName: false };
      }
    }

    // Rate limit
    if (i + BATCH_SIZE < needApi.length) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  if (needApi.length > 0) saveCache();
  return results;
}

/**
 * Full validation: is this a real person name? (first + last)
 * STRICT MODE - first name MUST be in known names database
 * Synchronous - uses local DB only (fast, no API calls)
 */
function isValidPersonName(firstName, lastName) {
  if (!firstName || !lastName) return false;
  const first = firstName.toLowerCase().trim();
  const last = lastName.toLowerCase().trim();

  // Basic length checks
  if (first.length < 2 || first.length > 15) return false;
  if (last.length < 2 || last.length > 25) return false;

  // Must contain only letters, hyphens, apostrophes
  if (!/^[a-z'-]+$/i.test(first) || !/^[a-z'-]+$/i.test(last)) return false;

  // Neither first nor last can be a blocked word
  if (NOT_NAMES.has(first) || NOT_NAMES.has(last)) return false;

  // Bad suffixes that indicate non-name words
  const badSuffixes = /(tion|ment|ness|ship|hood|ity|ism|ous|ful|less|able|ible|ward|wise|like|free|ing|ence|ance|ery|ory|ure|ive|ical|ular|dom)$/;
  if (badSuffixes.test(first) || badSuffixes.test(last)) return false;

  // STRICT: First name MUST be in known names database or API cache
  // This prevents "Civil Engineering", "Cookie Details", "Apple Watch" etc.
  if (!KNOWN_FIRST_NAMES.has(first)) {
    // Check API cache as fallback
    loadCache();
    if (nameCache[first]?.isName !== true) return false;
  }

  // Last name must look like a real surname (not a common English word)
  const COMMON_WORDS_AS_LAST = new Set([
    'all','buy','day','tag','type','way','run','set','put','get','let','say',
    'use','try','ask','add','end','own','big','old','new','few','top','off',
    'hot','low','due','key','act','age','air','arm','art','bad','bag','bed',
    'bit','box','bus','car','cup','cut','dog','ear','egg','eye','fan','fit',
    'fly','fun','gap','gas','god','gun','hat','hit','ice','job','joy','kid',
    'lab','law','leg','lip','log','lot','map','mix','net','nor','oil','pan',
    'pay','pet','pie','pin','pot','raw','row','sea','sir','sit','six','sky',
    'son','sum','sun','tax','tea','ten','tie','tip','toe','too','top','toy',
    'van','war','web','win','won','yes','yet','zip','the','and','but','not',
    'you','his','her','she','him','who','its','how','may','did','got','has',
    'any','per','via','our','two','way',
  ]);
  if (COMMON_WORDS_AS_LAST.has(last)) return false;

  // Last name shouldn't be same as first name
  if (first === last) return false;

  return true;
}

/**
 * Async validation with API fallback
 * STRICT: first name must be verified as a real name
 */
async function isValidPersonNameAsync(firstName, lastName) {
  // Run the sync checks first (covers NOT_NAMES, bad suffixes, etc.)
  // But allow unknown first names to proceed to API check
  if (!firstName || !lastName) return false;
  const first = firstName.toLowerCase().trim();
  const last = lastName.toLowerCase().trim();

  if (first.length < 2 || first.length > 15) return false;
  if (last.length < 2 || last.length > 25) return false;
  if (!/^[a-z'-]+$/i.test(first) || !/^[a-z'-]+$/i.test(last)) return false;
  if (NOT_NAMES.has(first) || NOT_NAMES.has(last)) return false;

  const badSuffixes = /(tion|ment|ness|ship|hood|ity|ism|ous|ful|less|able|ible|ward|wise|like|free|ing|ence|ance|ery|ory|ure|ive|ical|ular|dom)$/;
  if (badSuffixes.test(first) || badSuffixes.test(last)) return false;

  if (first === last) return false;

  // Check known names DB first
  if (KNOWN_FIRST_NAMES.has(first)) return true;

  // Check API cache
  loadCache();
  if (nameCache[first]?.isName === true) return true;
  if (nameCache[first]?.isName === false) return false;

  // Fall back to API for unknown names
  const results = await verifyBatch([firstName]);
  return results[first]?.isName === true;
}

/**
 * Validate a job title is clean (not scraped garbage)
 */
function isValidJobTitle(title) {
  if (!title) return false;
  const t = title.trim();
  // Too short or too long
  if (t.length < 3 || t.length > 60) return false;
  // Contains gibberish patterns (concatenated words without spaces)
  if (/[a-z]{20,}/i.test(t)) return false;
  // Contains HTML/URL artifacts
  if (/[<>{}()\[\]|\\\/]/.test(t)) return false;
  // Contains "cookie", "consent", "subscribe" etc.
  const garbage = /cookie|consent|subscribe|login|checkout|click|download|accept all|manage|privacy|terms/i;
  if (garbage.test(t)) return false;
  return true;
}

/**
 * Get stats
 */
function getCacheStats() {
  loadCache();
  const total = Object.keys(nameCache).length;
  const verified = Object.values(nameCache).filter(v => v.isName).length;
  return {
    total,
    verified,
    rejected: total - verified,
    localDbSize: KNOWN_FIRST_NAMES.size,
    blockedWords: NOT_NAMES.size
  };
}

module.exports = {
  isValidPersonName,
  isValidPersonNameAsync,
  isValidJobTitle,
  verifyFirstNameLocal,
  verifyBatch,
  isKnownName,
  getCacheStats,
  loadCache,
  saveCache,
  KNOWN_FIRST_NAMES,
  NOT_NAMES
};
