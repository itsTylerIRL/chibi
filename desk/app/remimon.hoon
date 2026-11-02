::  remimon: watches remilia-adjacent nft collections on ethereum.
::
::    polls a public json-rpc node over iris. every Transfer of a
::    watched collection is pulled with its transaction receipt, and
::    the marketplace events in that receipt give the sale price:
::
::      seaport  OrderFulfilled        listings and accepted offers
::      blur v2  Execution721*Packed   price packed into the event
::      blend    LoanOfferTaken/Repay  nft-backed loans, not sales
::
::    owner-only json api under /apps/remimon/api:
::
::      GET   /state          sync status, latest activity, all sales, @p names
::      GET   /find?q=        activity for a token id, 0x address or ~ship
::      POST  /settings       watchlist and alert rules (json, up to 8 kB)
::
/+  default-agent, dbug, server
|%
+$  act
  $:  hash=@ux  idx=@ud  coll=@tas  id=@ud
      from=@ux  to=@ux  kind=@tas  venue=@t  price=@ud   ::  price in wei
      block=@ud  at=@da
  ==
+$  job  [coll=@tas hash=@ux block=@ud at=@da]
+$  elog  [addr=@ux idx=@ud topics=(list @ux) data=(list @)]
+$  versioned-state  $%(state-0)
+$  state-0
  $:  %0
      head=(map @tas @ud)              ::  last block scanned, per collection
      latest=@ud                       ::  chain head at last poll
      acts=(list act)                  ::  newest first
      queue=(list job)                 ::  transactions waiting for a receipt
      busy=@ud                         ::  receipt requests in flight
      block-busy=?
      scanning=(set @tas)              ::  log requests in flight
      timer=(unit @da)
      names=(map @ux (list @p))        ::  owner address -> urbit ids
      checked=(set @ux)
      unchecked=(set @ux)
      settings=(unit @t)
      error=@t
  ==
+$  card  card:agent:gall
::  mirror of the parts of point:naive we read
::
+$  point
  $:  dominion=?(%l1 %l2 %spawn)
      $=  own
      $:  owner=[address=@ux nonce=@]
          spawn-proxy=[address=@ux nonce=@]
          management-proxy=[address=@ux nonce=@]
          voting-proxy=[address=@ux nonce=@]
          transfer-proxy=[address=@ux nonce=@]
      ==
      $=  net
      $:  rift=@ud
          keys=[life=@ud suite=@ud auth=@ crypt=@]
          sponsor=[has=? who=@p]
          escape=(unit @p)
  ==  ==
+$  points  (tree [ship point])
::
++  rpc-url   'https://rpc.mevblocker.io'
++  tick      ~s60
++  backfill  216.000          ::  ~30 days of blocks on the first sync
++  span      9.999            ::  the node allows 10k blocks per eth_getLogs
++  max-busy  4
++  max-acts  40.000
++  collections
  ^-  (list [key=@tas name=@t addr=@ux])
  :~  [%milady 'Milady' 0x5af0.d982.7e0c.53e4.799b.b226.655a.1de1.52a4.25a5]
      [%remilio 'Remilio' 0xd3d9.ddd0.cf0a.5f0b.fb8f.7fce.ae07.5df6.87ea.ebab]
      [%radbro 'Radbro' 0xabcd.b571.0b88.f456.fed1.e990.2537.9e29.69f2.9610]
      [%schizo 'SchizoPosters' 0xbfe4.7d6d.4090.940d.1c7a.0066.b63d.2387.5e3e.2ac5]
      [%yayo 'YAYO' 0x9f6.6a09.4a00.70eb.ddef.a192.a33f.a5d7.5b59.d46b]
  ==
++  transfer-topic  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
++  seaports
  (silt ~[0x68.f116.a894.984e.2db1.123e.b395 0xad.c04c.56bf.30ac.9d3c.0aaf.14dc])
++  blur      0xb2ec.fe4e.4d61.f879.0bbb.9de2.d125.9b9e.2410.cea5
++  blend     0x2946.9395.eaf6.f959.20e5.9f85.8042.f0e2.8d98.a20b
::  wrapped eth and blur pool count as eth
++  coins
  (silt ~[0xc02a.aa39.b223.fe8d.0a0e.5c4f.27ea.d908.3c75.6cc2 0xa3.9bb2.72e7.9075.ade1.25fd.3518.87ac])
::  first four bytes of each event topic
++  sig-transfer   0xddf2.52ad
++  sig-fulfilled  0x9d9a.f8e3
++  sig-blur       (silt ~[0x1d5e.12b5 0xfcf.17fa 0x7dc5.c069])
++  sig-loan       0x6a3.33c2
++  sig-repay      0x2469.cc9e
++  sig-seize      0xb71c.af41
++  sig-locked     0x7ffb.5bd9
--
::
%-  agent:dbug
=|  state-0
=*  state  -
^-  agent:gall
=<
|_  =bowl:gall
+*  this  .
    def   ~(. (default-agent this %|) bowl)
    hc    ~(. +> bowl)
++  on-init
  ^-  (quip card _this)
  =/  t  (add now.bowl ~s2)
  :_  this(timer `t)
  :~  [%pass /eyre/connect %arvo %e %connect [~ /apps/remimon] dap.bowl]
      [%pass /tick %arvo %b %wait t]
  ==
++  on-save  !>(state)
++  on-load
  |=  old=vase
  ^-  (quip card _this)
  =.  state  !<(versioned-state old)
  ?^  timer  `this
  =/  t  (add now.bowl ~s2)
  :_  this(timer `t)
  [%pass /tick %arvo %b %wait t]~
++  on-poke
  |=  [=mark =vase]
  ^-  (quip card _this)
  ?.  ?=(%handle-http-request mark)  (on-poke:def mark vase)
  =+  !<([eyre-id=@ta req=inbound-request:eyre] vase)
  =^  cards  state  (handle:hc eyre-id req)
  [cards this]
++  on-watch
  |=  =path
  ^-  (quip card _this)
  ?:  ?=([%http-response @ ~] path)  `this
  (on-watch:def path)
++  on-arvo
  |=  [=wire =sign-arvo]
  ^-  (quip card _this)
  ?+    wire  (on-arvo:def wire sign-arvo)
      [%eyre %connect ~]  `this
  ::
      [%tick ~]
    ?.  ?=([%behn %wake *] sign-arvo)  `this
    =^  cards  state  wake:hc
    [cards this]
  ::
      [%rpc *]
    ?.  ?=([%iris %http-response *] sign-arvo)  `this
    =/  res  client-response.sign-arvo
    ?:  ?=(%progress -.res)  `this
    =/  body=(unit json)
      ?.  ?=(%finished -.res)  ~
      ?.  =(200 status-code.response-header.res)  ~
      ?~  full-file.res  ~
      =/  j  (de:json:html q.data.u.full-file.res)
      ?~  j  ~
      =/  r  (field:hc u.j 'result')
      ?~  r  ~
      `r
    =^  cards  state  (take:hc t.wire body)
    [cards this]
  ==
++  on-peek
  |=  =path
  ^-  (unit (unit cage))
  ?+  path  (on-peek:def path)
    [%x %acts ~]   ``noun+!>(acts)
    [%x %names ~]  ``noun+!>(names)
  ==
++  on-agent  on-agent:def
++  on-leave  on-leave:def
++  on-fail   on-fail:def
--
::
|_  =bowl:gall
::
::  +wake: every minute, ask for the chain head, keep receipts flowing
::  and look up urbit ids for new addresses
::
::    while a backlog of receipts is waiting (first sync, or the node
::    rate-limited us), skip the chain head and come back in a few seconds
::
++  wake
  ^-  (quip card state-0)
  =/  backlog  ?=(^ queue)
  =/  t  (add now.bowl ?:(backlog ~s5 tick))
  =.  timer  `t
  =.  state  lookup
  =?  acts  (gth (lent acts) max-acts)  (scag max-acts acts)
  =^  c1  state  fill
  =/  c2=(list card)
    ?:  |(block-busy backlog)  ~
    [(rpc /rpc/block 'eth_blockNumber' a+~)]~
  =.  block-busy  |
  =?  block-busy  ?=(^ c2)  &
  :_  state
  ^-  (list card)
  :(weld ~[[%pass /tick %arvo %b %wait t]] c1 c2)
::
++  take
  |=  [=wire res=(unit json)]
  ^-  (quip card state-0)
  ?+  wire  `state
    [%block ~]  (take-block res)
  ::
      [%logs @ @ @ ~]
    (take-logs `@tas`i.t.wire (slav %ud i.t.t.wire) (slav %ud i.t.t.t.wire) res)
  ::
      [%tx @ @ @ @ ~]
    =/  =job
      :*  `@tas`i.t.wire
          (slav %ux i.t.t.wire)
          (slav %ud i.t.t.t.wire)
          (slav %da i.t.t.t.t.wire)
      ==
    (take-receipt job res)
  ==
::
++  take-block
  |=  res=(unit json)
  ^-  (quip card state-0)
  =.  block-busy  |
  =/  n=(unit @)  ?~(res ~ (bind (str u.res) unhex))
  ?~  n  `state(error 'could not reach the ethereum node')
  =.  latest  u.n
  =.  error  ''
  scan-all
::
++  scan-all
  ^-  (quip card state-0)
  =|  cards=(list card)
  =/  cs  collections
  |-
  ?~  cs  [cards state]
  =^  c  state  (scan key.i.cs)
  $(cs t.cs, cards (weld cards c))
::
::  +scan: ask for the next range of Transfer logs for a collection
::
++  scan
  |=  key=@tas
  ^-  (quip card state-0)
  ?:  (~(has in scanning) key)  `state
  ?:  (lth latest (add backfill 2))  `state
  =/  safe  (sub latest 2)
  =/  h  (~(gut by head) key (sub safe backfill))
  =.  head  (~(put by head) key h)
  ?:  (gte h safe)  `state
  =/  from  +(h)
  =/  to  (min safe (add from span))
  =/  addr  (coll-addr key)
  =/  params=json
    =,  enjs:format
    :-  %a
    :~  %-  pairs
        :~  address+s+(hexs 40 addr)
            topics+a+~[s+transfer-topic]
            ['fromBlock' s+(hexs 1 from)]
            ['toBlock' s+(hexs 1 to)]
    ==  ==
  :_  state(scanning (~(put in scanning) key))
  [(rpc /rpc/logs/[key]/(scot %ud from)/(scot %ud to) 'eth_getLogs' params)]~
::
++  take-logs
  |=  [key=@tas from=@ud to=@ud res=(unit json)]
  ^-  (quip card state-0)
  =.  scanning  (~(del in scanning) key)
  ?.  ?=([~ %a *] res)
    `state(error (rap 3 'log request failed for ' key ~))
  =.  queue  (weld queue (to-jobs key p.u.res))
  =.  head  (~(put by head) key to)
  =^  c1  state  (scan key)
  =^  c2  state  fill
  [(weld c1 c2) state]
::
::  +to-jobs: one job per transaction, oldest first
::
++  to-jobs
  |=  [key=@tas ls=(list json)]
  ^-  (list job)
  =/  js=(list job)
    %+  murn  ls
    |=  l=json
    ^-  (unit job)
    =/  h  (str (field l 'transactionHash'))
    =/  b  (str (field l 'blockNumber'))
    ?.  &(?=(^ h) ?=(^ b))  ~
    =/  ts  (str (field l 'blockTimestamp'))
    =/  at  ?~(ts now.bowl (from-unix:chrono:userlib (unhex u.ts)))
    `[key (unhex u.h) (unhex u.b) at]
  =|  seen=(set @ux)
  =|  out=(list job)
  |-
  ?~  js  (flop out)
  ?:  (~(has in seen) hash.i.js)  $(js t.js)
  $(js t.js, seen (~(put in seen) hash.i.js), out [i.js out])
::
::  +fill: keep up to max-busy receipt requests going
::
++  fill
  ^-  (quip card state-0)
  =|  cards=(list card)
  |-
  ?~  queue  [cards state]
  ?:  (gte busy max-busy)  [cards state]
  =*  j  i.queue
  =/  =wire
    /rpc/tx/[coll.j]/(scot %ux hash.j)/(scot %ud block.j)/(scot %da at.j)
  %=  $
    queue  t.queue
    busy   +(busy)
    cards  [(rpc wire 'eth_getTransactionReceipt' a+~[s+(hexs 64 hash.j)]) cards]
  ==
::
++  take-receipt
  |=  [=job res=(unit json)]
  ^-  (quip card state-0)
  =.  busy  ?:(=(0 busy) 0 (dec busy))
  ::  failed or not found yet: try again on the next tick
  ?.  ?=([~ %o *] res)  `state(queue (snoc queue job))
  =/  new  (decode job (coll-addr coll.job) (parse-logs u.res))
  =.  acts
    |-
    ?~  new  acts
    $(new t.new, acts (ins i.new acts))
  =.  unchecked  (~(gas in unchecked) (fresh new))
  fill
::
::  +fresh: addresses in new acts that we haven't looked up
::
++  fresh
  |=  new=(list act)
  ^-  (list @ux)
  =|  out=(list @ux)
  |-
  ?~  new  out
  =/  fa  from.i.new
  =/  ta  to.i.new
  =?  out  &(!=(0 fa) !(~(has in checked) fa))  [fa out]
  =?  out  &(!=(0 ta) !(~(has in checked) ta))  [ta out]
  $(new t.new)
::
::  +ins: put an act in place, newest first
::
++  ins
  |=  [a=act l=(list act)]
  ^-  (list act)
  =|  pre=(list act)
  |-
  ?~  l  (weld (flop pre) ~[a])
  ?:  (newer a i.l)  (weld (flop pre) [a l])
  ?:  &(=(hash.a hash.i.l) =(idx.a idx.i.l))  (weld (flop pre) l)
  $(pre [i.l pre], l t.l)
++  newer
  |=  [a=act b=act]
  ?:  =(block.a block.b)  (gth idx.a idx.b)
  (gth block.a block.b)
::
::  decoding
::
++  parse-logs
  |=  j=json
  ^-  (list elog)
  =/  ls  (field j 'logs')
  ?.  ?=([%a *] ls)  ~
  %+  murn  p.ls
  |=  l=json
  ^-  (unit elog)
  =/  a  (str (field l 'address'))
  =/  d  (str (field l 'data'))
  =/  i  (str (field l 'logIndex'))
  =/  t  (field l 'topics')
  ?.  &(?=(^ a) ?=(^ d) ?=(^ i) ?=([%a *] t))  ~
  :-  ~
  :^  (unhex u.a)  (unhex u.i)
    (turn p.t |=(x=json (unhex (fall (str x) ''))))
  (words u.d)
::
++  decode
  |=  [=job addr=@ux logs=(list elog)]
  ^-  (list act)
  =/  nfts=(list act)
    %+  murn  logs
    |=  l=elog
    ^-  (unit act)
    ?.  =(addr addr.l)  ~
    ?.  ?=([@ @ @ @ ~] topics.l)  ~
    ?.  =(sig-transfer (sig i.topics.l))  ~
    =/  from  (end [3 20] i.t.topics.l)
    =/  to  (end [3 20] i.t.t.topics.l)
    =/  kind=@tas
      ?:  =(0 from)  %mint
      ?:  |(=(0 to) =(0xdead to))  %burn
      %move
    `[hash.job idx.l coll.job `@ud`i.t.t.t.topics.l from to kind '' 0 block.job at.job]
  ?~  nfts  ~
  =/  sold  (sales addr logs)
  =/  tops=(set @)  (silt (turn logs |=(l=elog ?~(topics.l 0 (sig i.topics.l)))))
  =/  todo=(list act)  nfts
  =|  out=(list act)
  |-
  ?~  todo  (flop out)
  =/  a  i.todo
  ?.  =(%move kind.a)  $(todo t.todo, out [a out])
  =/  s  (~(get by sold) id.a)
  ::  a sale prices only the first transfer of that token in the tx
  ::
  ?^  s
    %=  $
      todo  t.todo
      sold  (~(del by sold) id.a)
      out   [a(kind %sale, venue venue.u.s, price price.u.s) out]
    ==
  =.  a
    ?:  (~(has in tops) sig-locked)  a(kind %sale, venue 'Blend')
    ?:  (~(has in tops) sig-loan)    a(kind %loan, venue 'Blend')
    ?:  (~(has in tops) sig-repay)   a(kind %repay, venue 'Blend')
    ?:  (~(has in tops) sig-seize)   a(kind %seize, venue 'Blend')
    a
  $(todo t.todo, out [a out])
::
::  +sales: token id -> venue and price, from marketplace events
::
++  sales
  |=  [addr=@ux logs=(list elog)]
  ^-  (map @ud [venue=@t price=@ud])
  =|  m=(map @ud [venue=@t price=@ud])
  |-
  ?~  logs  m
  =*  l  i.logs
  =/  s=@ux  ?~(topics.l 0x0 (sig i.topics.l))
  ?:  &((~(has in seaports) addr.l) =(s sig-fulfilled))
    $(logs t.logs, m (seaport m addr data.l))
  ?.  &(=(blur addr.l) (~(has in sig-blur) s))
    $(logs t.logs)
  ::  tokenIdListingIndexTrader, collectionPriceSide
  ::
  =/  tid  (rsh [3 21] (wd data.l 1))
  =/  cps  (wd data.l 2)
  =/  price  (cut 3 [20 11] cps)
  ?.  =(addr (end [3 20] cps))  $(logs t.logs)
  =?  m  !(~(has by m) tid)  (~(put by m) tid ['Blur' price])
  $(logs t.logs)
::
::  +seaport: OrderFulfilled(orderHash, recipient, offer[], consideration[])
::
::    if the nft is offered, the order was a listing and the price is
::    what was asked for it. if the nft is asked for, it was an offer
::    and the price is what was offered.
::
++  seaport
  |=  [m=(map @ud [venue=@t price=@ud]) addr=@ux w=(list @)]
  ^+  m
  =/  offer  (items w (div (wd w 2) 32) 4)
  =/  cons   (items w (div (wd w 3) 32) 5)
  =/  is-nft
    |=  i=(list @)
    ?&  |(=(2 (wd i 0)) =(4 (wd i 0)))
        =(addr (wd i 1))
    ==
  =/  in-offer  (skim offer is-nft)
  =/  ids=(list @ud)
    (turn (weld in-offer (skim cons is-nft)) |=(i=(list @) (wd i 2)))
  ?~  ids  m
  =/  pay  ?~(in-offer offer cons)
  =/  amt
    %+  roll  pay
    |=  [i=(list @) sum=@ud]
    ?.  |(=(0 (wd i 0)) &(=(1 (wd i 0)) (~(has in coins) (wd i 1))))  sum
    (add sum (wd i 3))
  ?:  =(0 amt)  m
  =/  per  (div amt (lent ids))
  =/  venue  ?~(in-offer 'OpenSea offer' 'OpenSea')
  =/  todo=(list @ud)  ids
  |-
  ?~  todo  m
  =?  m  !(~(has by m) i.todo)  (~(put by m) i.todo [venue per])
  $(todo t.todo)
::
::  +items: abi array of n-word structs at word p
::
++  items
  |=  [w=(list @) p=@ud n=@ud]
  ^-  (list (list @))
  =/  k  (wd w p)
  ?:  (gth k 64)  ~
  =|  out=(list (list @))
  =/  j  0
  |-
  ?:  =(j k)  (flop out)
  =/  base  :(add p 1 (mul j n))
  $(j +(j), out [(turn (gulf 0 (dec n)) |=(q=@ud (wd w (add base q)))) out])
::
++  wd
  |=  [w=(list @) i=@ud]
  ^-  @
  ?:  (gte i (lent w))  0
  (snag i w)
++  sig  |=(t=@ux (rsh [3 28] t))
::
::  +words: abi data as 32-byte words
::
++  words
  |=  t=@t
  ^-  (list @)
  =/  n  (div (sub (max 2 (met 3 t)) 2) 64)
  ?:  =(0 n)  ~
  =/  d  (unhex t)
  (flop (turn (gulf 1 n) |=(i=@ (cut 8 [(dec i) 1] d))))
::
++  unhex
  |=  t=@t
  ^-  @
  =?  t  =('0x' (end [3 2] t))  (rsh [3 2] t)
  (fall (rush t (bass 16 (plus hit))) 0)
++  hexs
  |=  [w=@ud a=@]
  ^-  @t
  (crip (weld "0x" ((x-co:co w) a)))
::
++  coll-addr
  |=  key=@tas
  ^-  @ux
  =/  c  (skim collections |=([k=@tas *] =(k key)))
  ?~(c 0x0 addr.i.c)
::
++  rpc
  |=  [=wire method=@t params=json]
  ^-  card
  =/  body=@t
    %-  en:json:html
    %-  pairs:enjs:format
    :~  jsonrpc+s+'2.0'
        id+n+'1'
        method+s+method
        params+params
    ==
  :*  %pass  wire  %arvo  %i  %request
      :*  %'POST'  rpc-url
          :~  ['content-type' 'application/json']
              ['user-agent' 'remimon (urbit)']
          ==
          `(as-octs:mimes:html body)
      ==
      *outbound-config:iris
  ==
::
::  +lookup: find urbit ids owned by addresses we haven't checked
::
++  lookup
  ^+  state
  ?:  =(~ unchecked)  state
  =/  our-p  (scot %p our.bowl)
  =/  now-p  (scot %da now.bowl)
  ?.  .^(? %gu /[our-p]/azimuth/[now-p]/$)  state
  =/  nas  .^([%0 =points operators=* dns=(list @t)] %gx /[our-p]/azimuth/[now-p]/nas/noun)
  =/  found  (owners unchecked points.nas)
  %=  state
    names      (~(uni by names) found)
    checked    (~(uni in checked) unchecked)
    unchecked  ~
  ==
++  owners
  |=  [want=(set @ux) a=points]
  ^-  (map @ux (list @p))
  =|  out=(map @ux (list @p))
  |-  ^+  out
  ?~  a  out
  =/  o  address.owner.own.+.n.a
  =?  out  (~(has in want) o)
    =/  l  (~(gut by out) o ~)
    ?:  (gte (lent l) 8)  out
    (~(put by out) o [-.n.a l])
  $(a r.a, out $(a l.a))
::
::  http
::
++  handle
  |=  [eyre-id=@ta req=inbound-request:eyre]
  ^-  (quip card state-0)
  =/  give  (cury give-simple-payload:app:server eyre-id)
  =/  rl  (parse-request-line:server url.request.req)
  ?.  authenticated.req
    ?:  ?=([%apps %remimon %api *] site.rl)  [(give [[403 ~] ~]) state]
    [(give (login-redirect:gen:server request.req)) state]
  =/  site=(list @t)
    ?.(?=([%apps %remimon *] site.rl) ~ t.t.site.rl)
  =*  method  method.request.req
  ?+    site  [(give not-found:gen:server) state]
      ~           [(give (ok 'text/html' (file /web/index/html))) state]
      [%$ ~]      [(give (ok 'text/html' (file /web/index/html))) state]
      [%app ~]    [(give (ok 'text/javascript' (file /web/app/js))) state]
      [%sigil ~]  [(give (ok 'text/javascript' (file /web/sigil/js))) state]
      [%style ~]  [(give (ok 'text/css' (file /web/style/css))) state]
      [%icon ~]   [(give (ok 'image/png' (file /web/icon/png))) state]
  ::
      [%api %state ~]
    [(give (json-response:gen:server state-json)) state]
  ::
      [%api %find ~]
    =/  q  (fall (get-header:http 'q' args.rl) '')
    =/  hits  (scag 1.000 (skim acts (matcher q)))
    [(give (json-response:gen:server a+(turn hits act-json))) state]
  ::
      [%api %settings ~]
    ?.  ?=(%'POST' method)  [(give [[405 ~] ~]) state]
    ?~  body.request.req  [(give [[400 ~] ~]) state]
    ?.  (lte p.u.body.request.req 8.192)  [(give [[400 ~] ~]) state]
    ?~  (de:json:html q.u.body.request.req)  [(give [[400 ~] ~]) state]
    [(give [[204 ~] ~]) state(settings `q.u.body.request.req)]
  ==
::
++  matcher
  |=  q=@t
  ^-  $-(act ?)
  ?:  =('~' (end 3 q))
    =/  p  (slaw %p q)
    ?~  p  |=(act |)
    =/  as=(set @ux)
      %-  silt
      %+  murn  ~(tap by names)
      |=  [a=@ux s=(list @p)]
      ?.((lien s |=(x=@p =(x u.p))) ~ `a)
    |=(a=act |((~(has in as) from.a) (~(has in as) to.a)))
  ?:  =('0x' (end [3 2] q))
    =/  x  (unhex q)
    |=(a=act |(=(x from.a) =(x to.a)))
  =/  id  (rush q dem)
  ?~  id  |=(act |)
  |=(a=act =(u.id id.a))
::
++  ok
  |=  [type=@t =octs]
  ^-  simple-payload:http
  [[200 ['content-type' type]~] `octs]
++  file
  |=  =path
  ^-  octs
  (as-octs:mimes:html .^(@t %cx (weld /(scot %p our.bowl)/[q.byk.bowl]/(scot %da now.bowl) path)))
::
::  json
::
++  field
  |=  [j=json k=@t]
  ^-  json
  ?.  ?=([%o *] j)  ~
  (fall (~(get by p.j) k) ~)
++  str
  |=  j=json
  ^-  (unit @t)
  ?.(?=([%s *] j) ~ `p.j)
::
::  +act-json: [hash, coll, id, from, to, kind, venue, gwei, at, block, idx]
::
++  act-json
  |=  a=act
  ^-  json
  =,  enjs:format
  :-  %a
  :~  s+(hexs 64 hash.a)
      s+coll.a
      (numb id.a)
      s+(hexs 40 from.a)
      s+(hexs 40 to.a)
      s+kind.a
      s+venue.a
      (numb (div price.a 1.000.000.000))
      (time at.a)
      (numb block.a)
      (numb idx.a)
  ==
++  state-json
  ^-  json
  =,  enjs:format
  %-  pairs
  :~  ship+s+(scot %p our.bowl)
      latest+(numb latest)
      backfill+(numb backfill)
      heads+(pairs (turn ~(tap by head) |=([k=@tas v=@ud] [k (numb v)])))
      queue+(numb (lent queue))
      busy+(numb busy)
      error+s+error
      :-  %collections
      :-  %a
      %+  turn  collections
      |=  [k=@tas n=@t a=@ux]
      (pairs ~[key+s+k name+s+n addr+s+(hexs 40 a)])
      acts+a+(turn (scag 1.200 acts) act-json)
      :-  %sales
      :-  %a
      %+  turn
        (skim acts |=(a=act &(=(%sale kind.a) (gth price.a 0))))
      act-json
      :-  %names
      %-  pairs
      %+  turn  ~(tap by names)
      |=  [a=@ux s=(list @p)]
      [(hexs 40 a) a+(turn s |=(p=@p s+(scot %p p)))]
      settings+?~(settings ~ (fall (de:json:html u.settings) ~))
  ==
--
