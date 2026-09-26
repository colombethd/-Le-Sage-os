# LE SAGE OS — Backend (BUILD 0-3)

Code source réel, conforme au cahier des charges §49-52 (TypeScript, Express,
PostgreSQL via Prisma, commandes métier explicites, montants en Decimal).

**Ce qui est implémenté (testable après déploiement) :**
- BUILD 0 — Organization/Location/User, JWT auth, RBAC middleware, AuditEvent
- BUILD 1 — Brand/Product/Variant/InventoryUnit (IMEI), InventoryMovement, data classification (coût caché aux vendeurs)
- BUILD 2 — Customer avec dédoublonnage téléphone (AUTO_MATCH)
- BUILD 3 — **Golden Sale** (`POST /api/v1/sales/complete`) : transaction atomique avec `SELECT ... FOR UPDATE` sur l'IMEI + isolation SERIALIZABLE, idempotence par `correlationId`, création vente/paiement/créance/mouvement stock/garantie/audit en un seul commit

**Ce qui N'EST PAS encore implémenté** (prochains builds, non bloquant pour tester le Golden Sale) :
- Route `/api/v1/auth/login` (le squelette de `jwt.ts`/`rbac.ts` est prêt, la route manque)
- Approval Engine complet (remise >10% est bloquée en dur, pas encore routée vers un approbateur)
- Finance Core, Procurement, SAV, Tasks/My Day, Analytics/DG Command Center, Ask LE SAGE
- Transactional outbox (notifications, analytics async — actuellement juste commentés dans `completeSale.ts`)
- Tests automatisés (unit/integration/concurrence) — la logique anti-double-vente est codée mais pas encore prouvée par un test écrit

## Pourquoi je n'ai pas pu tester ce code moi-même

Je l'ai écrit dans un environnement sans accès réseau (impossible d'installer
les dépendances npm ni de me connecter à une vraie base PostgreSQL). Le code
suit les patterns Prisma/Express standards mais **doit être testé avant toute
mise en production**, en particulier le test de concurrence de l'Annexe A
(deux ventes simultanées sur le même IMEI).

## Déploiement sur Railway (recommandé pour le pilote)

1. Créez un compte sur https://railway.app (carte bancaire requise pour dépasser le plan gratuit, mais le plan gratuit suffit pour démarrer).
2. **New Project → Deploy from GitHub repo** — poussez d'abord ce dossier sur un dépôt GitHub (créez-en un si besoin, `git init && git add . && git commit -m "LE SAGE OS BUILD 0-3"`).
3. Dans le même projet Railway : **+ New → Database → PostgreSQL**. Railway génère automatiquement `DATABASE_URL`.
4. Dans les **Variables** du service backend, ajoutez :
   - `DATABASE_URL` → référencez la variable de la base Postgres (Railway le propose automatiquement en tapant `${{Postgres.DATABASE_URL}}`)
   - `JWT_SECRET` → générez une valeur aléatoire longue (ex. `openssl rand -hex 32` en local)
   - `CORS_ORIGIN` → l'URL de votre futur frontend
5. **Settings → Build** : Build Command `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`, Start Command `npm start`.
6. Une fois déployé, exécutez la migration initiale et le seed depuis l'onglet **Shell** de Railway (ou en local avec `DATABASE_URL` pointé sur Railway) :
   ```
   npx prisma migrate dev --name init
   npm run seed
   ```
7. Testez : `curl https://<votre-app>.up.railway.app/health` doit répondre `{"status":"ok"}`.

## Développement local

```
cp .env.example .env   # renseignez une DATABASE_URL locale (ou Railway)
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev
```

## Prochaine étape recommandée

Avant d'ajouter d'autres modules : écrire le test de concurrence de l'Annexe A
(deux appels HTTP simultanés à `/api/v1/sales/complete` sur le même IMEI) et
vérifier qu'un seul réussit — c'est le Release Gate qui bloque toute mise en
production (§65, §78).
