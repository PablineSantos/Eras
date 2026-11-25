/**
 * HistoricalCodex — the museum's content (artifact + era lore).
 *
 * Every entry bridges 3 points so a player with zero computing-history background
 * gets the joke instantly:
 *   1. real world  — what it was, who made it, how people used it day to day;
 *   2. the problem — why it annoyed or amazed people at the time;
 *   3. the game    — how that trait literally became an obstacle or a power.
 *
 * Import graph (no cycles at module-evaluation time):
 *   types.ts  <-  HistoricalCodex.ts  <-  EraManager.ts  <-  AchievementSystem.ts
 * This module is a leaf: it imports ONLY from './types'. The unlock map's single source
 * of truth is `ARTIFACTS` in EraManager.ts; the `unlockedEras` literals below are only a
 * seed, and EraManager calls `syncArtifactUnlocks(ARTIFACTS)` right after declaring
 * ARTIFACTS, so `ARTIFACT_LORE[id].unlockedEras` always mirrors `ARTIFACTS[id].unlocks`
 * (a dev warning is printed if the seed drifted).
 *
 * All player-facing strings are PT-BR.
 */
import {
  ALL_ERAS,
  ArtifactId,
  EraId,
  eraLoreId,
  type ArtifactDef,
  type ArtifactLore,
  type EraLore,
  type LoreId,
} from './types';

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export const ARTIFACT_LORE: Record<ArtifactId, ArtifactLore> = {
  [ArtifactId.VALVE]: {
    id: ArtifactId.VALVE,
    name: 'Válvula Termiônica',
    popularNickname: 'A Lâmpada que Pensava',
    year: 1946,
    unlockedEras: [EraId.ASCII_1977],
    realWorldReference:
      'Antes dos chips de silício, computador era feito de válvulas: tubos de vidro parecidos com lâmpadas, que ligavam e desligavam a corrente elétrica. ' +
      'Elas foram inventadas em 1904 (John Ambrose Fleming), mas viraram cérebro de computador com o ENIAC, apresentado em 1946 na Universidade da Pensilvânia: ' +
      '17.468 válvulas, cerca de 27 toneladas, ocupando uma sala inteira e esquentando como um forno.',
    culturalFootnote:
      'Válvula queimava igual lâmpada — e, com milhares delas, alguma sempre estava queimando. Parte do trabalho era caçar a válvula morta e trocá-la. ' +
      'Curiosidade: a tela redonda do osciloscópio de 1958 também é um tubo de vácuo, primo da válvula.',
    gameplayTranslation:
      'Ela é a energia do mundo analógico de 1958: lá a física é "pura", sem ajuste no ar — o pulo segue uma parábola fixa, como uma bola de verdade. ' +
      'Coletá-la libera 1977: válvulas viraram transistores, transistores viraram chips, e em 1977 um computador inteiro cabia em cima da mesa.',
    impactQuote: 'Uma sala inteira de vidro quente… para fazer contas que hoje o seu relógio faz dormindo.',
    discoveryHint:
      'Algo brilha no alto, sobre a última plataforma antes da muralha de comentários. Em 1958 não dá para corrigir o pulo no ar: mire antes de saltar.',
  },
  [ArtifactId.FLOPPY]: {
    id: ArtifactId.FLOPPY,
    name: 'Disquete 5¼"',
    popularNickname: 'O Avô do Ícone de Salvar',
    year: 1976,
    unlockedEras: [EraId.MAC_1984, EraId.NES_1986],
    realWorldReference:
      'Em 1976, a Shugart Associates lançou o disquete de 5¼ polegadas: um disco magnético fininho e mole ("floppy" quer dizer molenga) dentro de uma capa de papelão. ' +
      'Pela primeira vez dava para levar programas e trabalhos para casa no bolso do casaco. Apple II e os primeiros PCs da IBM usavam esse formato, guardando entre uns 100 e 360 KB por disco.',
    culturalFootnote:
      'Sejamos honestos: o ícone de "Salvar" que você vê até hoje desenha o disquete de 3½" (o de plástico duro, com a portinha de metal, que veio depois). ' +
      'Mas foi o 5¼" que inventou o hábito de "salvar no disquete". E sim: ele morria se você dobrasse, encostasse num ímã ou esquecesse no sol.',
    gameplayTranslation:
      'Disquete = programas que você leva para onde quiser. Por isso ele libera duas eras: 1984, quando o Macintosh mostrava cada disco como um ícone na mesa ' +
      'e as janelas viraram objetos que você agarra e arrasta (no jogo, uma janela vira ponte); e 1986, quando até a Nintendo lançou um drive de disquete próprio no Japão ' +
      '(Famicom Disk System, onde estreou The Legend of Zelda) — e você ganha controle no ar e pulo variável.',
    impactQuote: 'Não dobre. Não molhe. Não chegue perto de ímã. E, por favor, salve antes de desligar.',
    discoveryHint:
      'Ele espera do outro lado da muralha marcada com "//". Para o computador, um comentário é invisível — só quem fala a língua de 1977 passa.',
  },
  [ArtifactId.BALL_MOUSE]: {
    id: ArtifactId.BALL_MOUSE,
    name: 'Mouse de Bola',
    popularNickname: 'O Rato da Xerox PARC e do Macintosh',
    year: 1984,
    unlockedEras: [EraId.WIN95_1995, EraId.Y2K_1999],
    realWorldReference:
      'O primeiro mouse foi feito nos anos 1960 por Douglas Engelbart e Bill English: uma caixinha de madeira com duas rodinhas de metal. O fio parecia um rabo — daí o nome "rato". ' +
      'Nos anos 1970, a Xerox PARC trocou as rodinhas por uma bola; em 1984 o Macintosh colocou o mouse na mesa de gente comum. ' +
      'Dentro, uma bola de borracha girava dois roletes: um media o movimento para os lados, o outro para cima e para baixo.',
    culturalFootnote:
      'A bola recolhia poeira, pelo de gato e migalha de biscoito. Os roletes criavam um anel de sujeira, o cursor começava a travar, ' +
      'e todo mundo aprendeu o ritual: abrir a tampinha, tirar a bola e raspar os roletes com a unha. Nos anos 2000, os mouses ópticos (de luz) aposentaram a bola.',
    gameplayTranslation:
      'O mouse é a ferramenta da era das janelas e dos cliques. Ele libera 1995 — todo PC com Windows 95 vinha com um mouse de bola, ' +
      'e você precisa dele para clicar no OK do pop-up que tapa o caminho — e 1999, o fim do milênio navegado no clique (com o Bullet Time de Matrix para os lasers).',
    impactQuote: 'Apontar e clicar mudou tudo. Limpar a bola, nem tanto.',
    discoveryHint:
      'Ele espera no alto da chaminé, encostado num pop-up de erro que ninguém consegue fechar sem clicar.',
  },
  [ArtifactId.CARTRIDGE]: {
    id: ArtifactId.CARTRIDGE,
    name: 'Cartucho 8-Bit',
    popularNickname: 'Assopra que Funciona!',
    year: 1983,
    unlockedEras: [EraId.SNES_1991],
    realWorldReference:
      'Um cartucho é uma plaquinha com chips de memória ROM ("memória só de leitura") dentro de uma caixa de plástico. O jogo já está gravado no chip: ' +
      'encaixou, ligou, jogou — sem tela de carregamento. Foi assim no Famicom (Japão, 1983), no NES e, no Brasil, nos clones e no Master System.',
    culturalFootnote:
      'Todo mundo assoprava o cartucho quando o jogo não ligava. Spoiler: quase sempre o que resolvia era só tirar e encaixar de novo. ' +
      'A própria Nintendo pedia para não assoprar: a umidade do sopro ajudava a oxidar os contatos.',
    gameplayTranslation:
      'Cartucho é tempo zero: encaixou, jogou. Ele libera 1991, a era 16-bit do Super Nintendo e do Mega Drive — ainda em cartucho, agora com o dobro de bits: ' +
      'inércia de verdade (você embala e demora a parar) e pulo na parede.',
    impactQuote: 'Fffffff… pronto, agora funciona. (Não funciona. Mas a gente acreditava.)',
    discoveryHint:
      'Fica no fim do túnel de espinhos de 8 bits, ao pé de uma chaminé estreita demais para subir pulando normalmente.',
  },
  [ArtifactId.CD_ROM]: {
    id: ArtifactId.CD_ROM,
    name: 'CD-ROM',
    popularNickname: '650 Megabytes de Futuro Espelhado',
    year: 1985,
    unlockedEras: [EraId.FLASH_2005],
    realWorldReference:
      'Sony e Philips criaram o CD de música em 1982 e, em 1985, o CD-ROM para dados. Um laser lê furinhos microscópicos numa camada espelhada. ' +
      'Cabiam cerca de 650 MB — mais do que 450 disquetes de 3½" de 1,44 MB. Nos anos 1990 ele trouxe enciclopédias com vídeo e som, jogos enormes e instaladores de programas.',
    culturalFootnote:
      'O Windows 95 também foi vendido em 13 disquetes; no CD, era um disco só. E provedores de internet mandavam CDs de instalação de graça pelo correio — ' +
      'muita gente usou de porta-copos ou de espelho anti-pássaro no quintal.',
    gameplayTranslation:
      'O CD trouxe o "multimídia": vídeo, música e tudo brilhando — a mesma vontade de brilho que virou os botões espelhados da Web 2.0. ' +
      'Ele libera 2005: botões tão "físicos" que viram paredes sólidas, e um salto a mais de capacidade — o pulo duplo.',
    impactQuote: 'Um disco só, mais de 450 disquetes dentro. E ainda refletia a sua cara.',
    discoveryHint:
      'Ele gira na base de uma torre alta demais para um pulo só. Repare na mola ali perto.',
  },
  [ArtifactId.GPU_NEON]: {
    id: ArtifactId.GPU_NEON,
    name: 'GPU Neon',
    popularNickname: 'A Máquina de Shaders e Realidades',
    year: 1999,
    unlockedEras: [EraId.FLAT_2013, EraId.NEON_2026],
    realWorldReference:
      'GPU é a placa de vídeo: um processador só para desenhar imagens, calculando milhões de pixels de uma vez. Em 1999 a NVIDIA lançou a GeForce 256 e a anunciou como "a primeira GPU" — ' +
      'ela própria calculava a geometria e a iluminação 3D, trabalho que antes sobrava para o processador principal. Pouco depois as GPUs passaram a rodar "shaders": ' +
      'pequenos programas que decidem a cor de cada pixel — sombra, brilho, vidro, neon.',
    culturalFootnote:
      'No mesmo ano, 1999, Matrix estreou com o "bullet time" — que, aliás, foi feito com dezenas de câmeras fotográficas enfileiradas, não com placa de vídeo. ' +
      'Hoje as GPUs desenham jogos, interfaces inteiras e também treinam inteligências artificiais.',
    gameplayTranslation:
      'Toda interface moderna é desenhada pela GPU. Ela libera 2013, o Flat Design (o iOS 7 trocou texturas por cores lisas, mas encheu a tela de transparências desfocadas), ' +
      'com o Dash; e 2026, onde painéis de vidro fosco só existem porque a GPU desfoca o fundo em tempo real — e esses painéis viram chão.',
    impactQuote: 'Milhões de pixels por segundo, e você ainda reclama do brilho da tela.',
    discoveryHint:
      'Ela brilha no alto da torre, onde só quem pula duas vezes chega — bem diante de um botão gordo e brilhante que tapa um túnel.',
  },
};

// ---------------------------------------------------------------------------
// Eras
// ---------------------------------------------------------------------------

export const ERA_LORE: Record<EraId, EraLore> = {
  [EraId.VECTOR_1958]: {
    era: EraId.VECTOR_1958,
    year: 1958,
    title: 'Tennis for Two',
    subtitle: 'O primeiro "videogame" foi uma bolinha verde num aparelho de laboratório.',
    paradigm: 'Computação analógica com tela de osciloscópio',
    realWorldReference:
      'Em outubro de 1958, o físico William Higinbotham montou um jogo de tênis para o dia de visitas do Brookhaven National Laboratory, nos EUA. ' +
      'A "tela" era um osciloscópio redondo — um aparelho de medir sinais elétricos — e um computador analógico (sem software, só circuitos) calculava a trajetória da bola em tempo real, com gravidade de verdade.',
    everydayExperience:
      'Os visitantes faziam fila para jogar. Cada jogador tinha uma caixinha com um botão giratório para escolher o ângulo e um botão para rebater. ' +
      'Depois de rebater, não dava para mudar nada: a bola seguia a curva que os circuitos calculavam.',
    mechanicExplanation:
      'Aqui você é aquela bolinha. O pulo segue uma parábola fixa: decidiu, pulou, acabou — não dá para corrigir no ar. ' +
      'O traço verde que fica para trás é o rastro do fósforo do osciloscópio, que demora um pouco para apagar.',
    quickTipToast: '1958 (Tennis for Two): o pulo é uma parábola fixa, como a bola do osciloscópio — mire antes de pular!',
    discoveryHint: 'O começo de tudo. Uma bolinha verde num laboratório de física.',
  },
  [EraId.ASCII_1977]: {
    era: EraId.ASCII_1977,
    year: 1977,
    title: 'Linha de Comando',
    subtitle: 'Sem janelas, sem mouse: você conversa com o computador digitando.',
    paradigm: 'Interface de linha de comando (CLI)',
    realWorldReference:
      'Em 1977 chegaram os primeiros computadores pessoais vendidos prontos: Apple II, Commodore PET e TRS-80. ' +
      'Não havia janelas nem ícones — era a "linha de comando" (CLI): uma tela preta, um cursor piscando, e você digitava ordens como "RUN" ou "LOAD".',
    everydayExperience:
      'Ligar o computador era encarar um cursor esperando instruções. Errou uma letra? "SYNTAX ERROR". ' +
      'Muita gente aprendeu a programar copiando, linha por linha, programas impressos em revistas.',
    mechanicExplanation:
      'Em código, "//" transforma a linha em comentário: um bilhete para humanos que o computador ignora por completo (o truque vem da linguagem BCPL, de 1967, e ficou famoso no C++). ' +
      'No jogo, paredes marcadas com "//" são comentários — em 1977 o mundo as ignora e você atravessa como se não existissem.',
    quickTipToast: "1977 (linha de comando): em código, '//' vira comentário ignorado — atravesse os blocos comentados!",
    discoveryHint: 'Um cursor pisca no escuro. Algo feito de vidro e calor pode acordá-lo.',
  },
  [EraId.MAC_1984]: {
    era: EraId.MAC_1984,
    year: 1984,
    title: 'Macintosh e a Mesa de Trabalho',
    subtitle: 'A tela vira uma mesa: pastas, lixeira e janelas que você pega com o mouse.',
    paradigm: 'Interface gráfica (GUI) e metáfora da mesa de trabalho',
    realWorldReference:
      'Interface gráfica (GUI) é apontar e clicar em desenhos — ícones, menus, janelas — em vez de digitar comandos. ' +
      'A ideia nasceu nos anos 1970 na Xerox PARC, com o computador Alto. Em janeiro de 1984 a Apple lançou o Macintosh e levou isso para o público: ' +
      'tela de 9 polegadas, 512×342 pontos, só preto e branco (1 bit por ponto: aceso ou apagado).',
    everydayExperience:
      'Pela primeira vez muita gente usou um computador sem decorar comando nenhum: arquivo era uma folhinha, pasta era uma pasta, apagar era arrastar para a lixeira. ' +
      'As janelas se empilhavam como papéis numa mesa, e dava para arrastá-las com o mouse.',
    mechanicExplanation:
      'Se a tela é uma mesa, as janelas são objetos de verdade. Em 1984 uma janela vira plataforma sólida: arraste-a pela barra de título até o meio do abismo e use-a como ponte.',
    quickTipToast: '1984 (Macintosh): janelas viraram objetos na mesa — arraste a janela pelo título e faça uma ponte sobre o abismo!',
    discoveryHint: 'Uma mesa de trabalho em preto e branco te espera. Para chegar lá, você precisa de algo para carregar programas no bolso.',
  },
  [EraId.NES_1986]: {
    era: EraId.NES_1986,
    year: 1986,
    title: 'Consoles 8-Bit',
    subtitle: 'O videogame entra na sala — e o pulo ganha controle.',
    paradigm: 'Jogos de plataforma 8-bit',
    realWorldReference:
      'Em meados dos anos 1980 o Nintendo (NES/Famicom) espalhou o videogame pelas salas de estar. "8 bits" quer dizer que o processador lidava com números pequenos, de 0 a 255, de cada vez — ' +
      'por isso gráficos de quadradinhos e poucas cores. Super Mario Bros. (1985) virou o modelo de jogo de plataforma.',
    everydayExperience:
      'Controle com direcional em cruz e dois botões, cartucho encaixado, a família inteira disputando a vez. Ficar horas tentando passar de fase era normal.',
    mechanicExplanation:
      'O Mario trouxe dois truques que hoje parecem óbvios: dá para mudar a direção no meio do pulo (controle aéreo) ' +
      'e a altura depende de quanto tempo você segura o botão — toque curto, pulinho; segurar, pulo alto. No túnel com espinhos no teto, só o pulinho passa.',
    quickTipToast: '1986 (8-bit, estilo Mario): segurar o pulo = pulo alto; toque curto = pulinho — use o pulinho no túnel de espinhos!',
    discoveryHint: 'Um cartucho de cores vibrantes e pulos controláveis. Quem guarda programas em disco abre essa porta.',
  },
  [EraId.SNES_1991]: {
    era: EraId.SNES_1991,
    year: 1991,
    title: '16-Bit e Parallax',
    subtitle: 'Cenários em camadas, velocidade e embalo.',
    paradigm: 'Jogos 16-bit: parallax e física com embalo',
    realWorldReference:
      'Super Nintendo e Mega Drive (no Brasil, pela Tectoy) dominaram o começo dos anos 1990. Com 16 bits, cabiam mais cores e várias camadas de cenário. ' +
      'O "parallax" é o truque de mover o fundo mais devagar que a frente, como a paisagem vista da janela do carro, criando profundidade. ' +
      'Sonic (1991) fez sucesso com velocidade e embalo.',
    everydayExperience:
      'Revistas de videogame, locadoras, a briga "Nintendo ou Sega?". Os personagens deixaram de parar seco: ganhavam velocidade aos poucos e derrapavam para frear.',
    mechanicExplanation:
      'Em 1991 o corpo tem inércia: acelera e desacelera em vez de parar seco. E vale o pulo na parede (wall-jump), que jogos 16-bit como Mega Man X e Super Metroid popularizaram: ' +
      'encoste na parede e aperte pulo para quicar de um lado para o outro e subir a chaminé estreita.',
    quickTipToast: '1991 (16-bit): agora tem embalo e pulo na parede — quique entre as paredes para subir a chaminé!',
    discoveryHint: 'Camadas de cenário deslizando em velocidades diferentes. Um cartucho com o dobro de bits abre essa porta.',
  },
  [EraId.WIN95_1995]: {
    era: EraId.WIN95_1995,
    year: 1995,
    title: 'Windows 95',
    subtitle: 'Botão Iniciar, cinza em relevo e caixas de erro por todo lado.',
    paradigm: 'Desktop do PC doméstico e a web nascente',
    realWorldReference:
      'Em agosto de 1995 a Microsoft lançou o Windows 95, com botão Iniciar, barra de tarefas e botões cinza "em relevo". O PC virou eletrodoméstico, ' +
      'e a internet começava a chegar às casas — junto com o "404", o erro de página não encontrada.',
    everydayExperience:
      'Internet discada apitando, programa travando, e janelinhas de erro brotando na frente do que você queria fazer. A reação virou reflexo: mirar no [X] e fechar.',
    mechanicExplanation:
      'Em 1995 quem manda é o mouse. O pop-up "Erro 404" é uma parede sólida no corredor dos lasers (em qualquer era) até ser fechado — e só aparece de verdade em 1995: ' +
      'clique no [X] ou no OK para tirá-lo da frente. Em troca, o sistema não deixa pular na parede.',
    quickTipToast: '1995 (Windows 95): o pop-up 404 tapa o caminho — clique no [X] para fechá-lo (aqui não tem pulo na parede)!',
    discoveryHint: 'Um botão Iniciar e uma caixa de erro irritante. Só quem tem um mouse consegue fechá-la.',
  },
  [EraId.Y2K_1999]: {
    era: EraId.Y2K_1999,
    year: 1999,
    title: 'Bug do Milênio e Matrix',
    subtitle: 'O mundo com medo do ano 2000 — e o tempo em câmera lenta.',
    paradigm: 'Estética Y2K: verde de terminal, metal cromado e skins',
    realWorldReference:
      'O "bug do milênio" (Y2K): para economizar memória, muitos sistemas antigos guardavam o ano só com dois dígitos — 1999 virava "99". ' +
      'Na virada, "00" poderia ser lido como 1900, bagunçando bancos, contas e agendas. O mundo gastou centenas de bilhões de dólares corrigindo, e quase nada quebrou. ' +
      'No mesmo ano, Matrix popularizou o "bullet time": a ação congela em câmera lenta enquanto a câmera gira.',
    everydayExperience:
      'Notícias sobre aviões caindo e bancos zerando à meia-noite, gente sacando dinheiro por precaução, Winamp tocando MP3 com skins cromadas e chuva de letras verdes como protetor de tela.',
    mechanicExplanation:
      'Em 1999 você ganha o Bullet Time: toque em Shift (liga/desliga) e os obstáculos passam a andar a 40% da velocidade. Os lasers do corredor piscam rápido demais para atravessar normalmente — ' +
      'em câmera lenta, a brecha entre um disparo e outro fica grande o bastante.',
    quickTipToast: '1999 (Matrix): toque Shift para ligar o Bullet Time — os lasers ficam lentos e dá para passar entre os disparos!',
    discoveryHint: 'Números verdes chovendo e um relógio prestes a virar para 2000. Quem aponta e clica também destrava esse tempo.',
  },
  [EraId.FLASH_2005]: {
    era: EraId.FLASH_2005,
    year: 2005,
    title: 'Web 2.0 e Skeuomorfismo',
    subtitle: 'Botões tão brilhantes que dava vontade de lamber.',
    paradigm: 'Skeuomorfismo: telas imitando objetos reais',
    realWorldReference:
      'Skeuomorfismo é quando a tela imita objetos de verdade: couro costurado, madeira, metal escovado, botões de vidro com reflexo. ' +
      'Na metade dos anos 2000, a "Web 2.0" era feita de botões brilhantes, cantos arredondados e animações em Flash; depois vieram o Aero do Windows Vista ' +
      'e o iPhone (2007), com o app de notas imitando bloco de papel amarelo.',
    everydayExperience:
      'Orkut, MSN, vídeos em Flash e sites com selo "beta". O botão tinha sombra, reflexo e degradê — parecia que dava para apertar com o dedo.',
    mechanicExplanation:
      'Se o botão parece um objeto de verdade, ele tem volume de verdade: no jogo os botões brilhantes de 2005 são paredes sólidas. ' +
      'E 2005 te dá um salto a mais — o pulo duplo — para subir a torre depois da mola.',
    quickTipToast: '2005 (Web 2.0): botões brilhantes têm "volume físico" e são sólidos — use o pulo duplo para subir a torre!',
    discoveryHint: 'Tudo brilha, tudo tem reflexo. Um disco espelhado mostra o caminho.',
  },
  [EraId.FLAT_2013]: {
    era: EraId.FLAT_2013,
    year: 2013,
    title: 'Flat Design',
    subtitle: 'Da noite para o dia, todo o relevo sumiu.',
    paradigm: 'Design plano: cores lisas, sem textura nem sombra',
    realWorldReference:
      'O Flat Design ("design plano") jogou fora couro, madeira e reflexos: só cores lisas, ícones simples e muito espaço em branco. ' +
      'A Microsoft já vinha nessa linha com o estilo Metro (Windows Phone 7, em 2010, e Windows 8, em 2012). Em 2013 a Apple lançou o iOS 7 e achatou o iPhone inteiro de uma vez.',
    everydayExperience:
      'Você atualizou o celular e todos os ícones mudaram. Uns amaram, outros reclamaram que não sabiam mais o que era botão e o que era texto.',
    mechanicExplanation:
      'Ao trocar de 2005 para 2013, o botão brilhante perde todo o volume e vira um desenho chapado — e desenho chapado não segura ninguém: você passa através dele. ' +
      '2013 também te dá o Dash, uma arrancada curta para atravessar o túnel baixo.',
    quickTipToast: '2013 (Flat Design): o relevo sumiu — o botão brilhante fica chapado e atravessável; use o Dash no túnel!',
    discoveryHint: 'Um mundo sem sombras, sem texturas, sem relevo. Só uma placa de vídeo poderosa desenha algo tão simples.',
  },
  [EraId.NEON_2026]: {
    era: EraId.NEON_2026,
    year: 2026,
    title: 'Vidro Espacial',
    subtitle: 'Painéis de vidro fosco flutuando no ar.',
    paradigm: 'Interfaces espaciais e Glassmorphism',
    realWorldReference:
      'Glassmorphism é o estilo de "vidro fosco": painéis translúcidos que desfocam o que está atrás, com bordas que pegam luz. O termo viralizou por volta de 2020, ' +
      'e o estilo explodiu com os óculos de realidade mista (Apple Vision Pro, Meta Quest), em que as janelas flutuam no seu quarto, e com o "Liquid Glass" que a Apple apresentou em 2025.',
    everydayExperience:
      'Menus que deixam ver o fundo borrado, janelas flutuando no ar à sua frente, controles que reagem à luz. Bonito — e às vezes difícil de ler.',
    mechanicExplanation:
      'Em 2026 os painéis de vidro existem de verdade e viram chão sobre o abismo — em qualquer outra era eles somem. ' +
      'O teto baixo não deixa pular: corra e use o Dash de painel em painel.',
    quickTipToast: '2026 (vidro fosco): os painéis de vidro só existem nesta era — use-os de chão e dê Dash entre eles!',
    discoveryHint: 'Vidro flutuando no escuro, brilhando em neon. O fim da linha do tempo — por enquanto.',
  },
};

// ---------------------------------------------------------------------------
// Ids & getters
// ---------------------------------------------------------------------------

/** 6 artifact ids + 10 era ids (`era-<year>`), in museum order. */
export const ALL_LORE_IDS: readonly LoreId[] = [
  ...(Object.values(ArtifactId) as ArtifactId[]),
  ...ALL_ERAS.map((era) => eraLoreId(era)),
];

export function getArtifactLore(id: ArtifactId): ArtifactLore {
  return ARTIFACT_LORE[id];
}

export function getEraLore(id: EraId): EraLore {
  return ERA_LORE[id];
}

/** True if `id` is a known lore id (artifact or era). */
export function isLoreId(id: unknown): id is LoreId {
  return typeof id === 'string' && (ALL_LORE_IDS as readonly string[]).includes(id);
}

/**
 * Makes `ARTIFACT_LORE[id].unlockedEras` mirror the game's real unlock map.
 * Called once by EraManager.ts right after `ARTIFACTS` is declared (so no circular import).
 */
export function syncArtifactUnlocks(defs: Record<ArtifactId, ArtifactDef>): void {
  for (const id of Object.values(ArtifactId) as ArtifactId[]) {
    const def = defs[id];
    if (!def) continue;
    const lore = ARTIFACT_LORE[id];
    const seed = lore.unlockedEras;
    const drifted = seed.length !== def.unlocks.length || seed.some((era, i) => era !== def.unlocks[i]);
    if (drifted && import.meta.env?.DEV) {
      console.warn(`[HistoricalCodex] unlockedEras of "${id}" drifted from ARTIFACTS; using ARTIFACTS.`);
    }
    lore.unlockedEras = [...def.unlocks];
  }
}
