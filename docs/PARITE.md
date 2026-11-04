# Parité avec l'API Proxmox VE

Doc de l'API récupérée le 2026-11-04 (copie dans `docs/api/apidoc.js`, à rafraîchir avec `--refresh`).

Inventaire de tous les points d'entrée de l'API Proxmox VE, et de ce que MyProxmox en couvre. Fichier produit par `scripts/api-inventory.mjs` le 2026-11-04, à partir de la doc officielle (https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js).

Ne le modifie pas à la main : relance `node scripts/api-inventory.mjs` à la fin de chaque phase. La colonne « MyProxmox » est recalculée en cherchant les chemins appelés dans `web/src`, `shared` et `server/src`.

La doc en ligne suit la dernière version de Proxmox VE. Quelques points d'entrée récents (par exemple les fabrics et route maps du SDN, ou `/cluster/bulk-action`) n'existent pas en 8.x : l'interface devra les masquer quand le serveur ne les propose pas.

## Résumé

| Zone | Points d'entrée | Fait | À faire | Hors périmètre | Phases |
|---|--:|--:|--:|--:|---|
| [Datacenter](#datacenter) | 203 | 22 | 169 | 12 | 3 (lecture sauvegardes), 6 |
| [Cluster](#cluster) | 60 | 9 | 42 | 9 | 3 (quorum, HA, tâches), 6 |
| [Nœud](#nœud) | 173 | 35 | 116 | 22 | 3 (lecture), 5 |
| [VM QEMU](#vm-qemu) | 97 | 41 | 49 | 7 | 4 |
| [Conteneur LXC](#conteneur-lxc) | 62 | 39 | 17 | 6 | 4 |
| [Stockage](#stockage) | 33 | 7 | 24 | 2 | 3 (occupation), 7 |
| [Accès](#accès) | 45 | 14 | 28 | 3 | 1 (permissions), 6 |
| [Pools](#pools) | 7 | 1 | 6 | 0 | 6 |
| **Total** | **680** | **168** | **451** | **61** | |

## Phases

| Phase | Sujet | Zones couvertes |
|---|---|---|
| 1 | Socle commun | Composants partagés (tableau, formulaire, assistant, journal de tâche, arbre). Accès : `GET /access/permissions` pour masquer les actions interdites. Cluster : `/cluster/resources` pour l'arbre. |
| 2 | Comptes MyProxmox et monitoring seul | Comptes locaux propres à MyProxmox. Aucun nouveau point d'entrée Proxmox, à part `POST /access/ticket` déjà utilisé. |
| 3 | Monitoring complet | Lecture seule. Nœud (status, rrddata, netstat, disques, services, apt), Cluster (status, HA, tâches, log), Datacenter (sauvegardes planifiées), Stockage (rrddata). |
| 4 | VM et conteneurs | Zones VM QEMU et Conteneur LXC en entier, console comprise (vncproxy, termproxy, vncwebsocket). |
| 5 | Nœud | Zone Nœud : réseau, certificats et ACME, apt, disques, Ceph, réplication, journaux, services, pare-feu, abonnement, shell. |
| 6 | Datacenter, cluster, accès, SDN | Zones Datacenter, Cluster, Accès et Pools : options, définitions de stockage, sauvegardes, HA, SDN, permissions, ACME, métriques, notifications, mappings, pare-feu. |
| 7 | Stockage et contenu | Zone Stockage : téléversement, téléchargement, contenu, disques orphelins, PBS, rrddata. |
| 8 | MCP et finitions | Outils MCP en lecture sur les nouvelles zones, tests, accessibilité. Ce qui reste « À faire » ici passe dans le README, rubrique « Pas encore couvert ». |

## Légende

- **Fait** : MyProxmox appelle déjà ce chemin avec cette méthode. Ça ne veut pas dire que toutes les options du point d'entrée sont proposées dans l'interface.
- **À faire** : pas encore utilisé.
- **Hors périmètre** : sans intérêt pour un humain. Les règles appliquées :
  - index de navigation de l'API (un `GET` qui ne fait que lister des sous-chemins fixes) ;
  - points d'entrée que la doc réserve à un usage interne de Proxmox (tunnels de migration, ajout d'un nœud par la jonction) ;
  - `GET /access/ticket` : page factice pour les formateurs de l'API ;
  - `GET /cluster/config/apiversion` : version du protocole de jonction, lue par pvecm ;
  - `POST /nodes/{node}/execute` : exécution groupée d'appels, réservée aux outils ;
- Les descriptions viennent de la doc officielle, en anglais. La colonne « Permission » résume le contrôle d'accès demandé par Proxmox.

## Datacenter

203 points d'entrée : 22 faits, 169 à faire, 12 hors périmètre.

### Datacenter : acme

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/acme` | ACMEAccount index. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/acme/account` | ACMEAccount index. | tout utilisateur connecté | À faire |
| POST | `/cluster/acme/account` | Register a new ACME account with CA. | non précisée | À faire |
| GET | `/cluster/acme/account/{name}` | Return existing ACME account information. | non précisée | À faire |
| PUT | `/cluster/acme/account/{name}` | Update existing ACME account information with CA. Note: not specifying any new account information triggers a refresh. | non précisée | À faire |
| DELETE | `/cluster/acme/account/{name}` | Deactivate existing ACME account at CA. | non précisée | À faire |
| GET | `/cluster/acme/challenge-schema` | Get schema of ACME challenge types. | tout utilisateur connecté | À faire |
| GET | `/cluster/acme/directories` | Get named known ACME directory endpoints. | tout utilisateur connecté | À faire |
| GET | `/cluster/acme/meta` | Retrieve ACME Directory Meta Information | Sys.Audit sur /nodes/{node} | À faire |
| GET | `/cluster/acme/plugins` | ACME plugin index. | Sys.Modify sur / | À faire |
| POST | `/cluster/acme/plugins` | Add ACME plugin configuration. | Sys.Modify sur / | À faire |
| GET | `/cluster/acme/plugins/{id}` | Get ACME plugin configuration. | Sys.Modify sur / | À faire |
| PUT | `/cluster/acme/plugins/{id}` | Update ACME plugin configuration. | Sys.Modify sur / | À faire |
| DELETE | `/cluster/acme/plugins/{id}` | Delete ACME plugin configuration. | Sys.Modify sur / | À faire |
| GET | `/cluster/acme/tos` | Retrieve ACME TermsOfService URL from CA. Deprecated, please use /cluster/acme/meta. | tout utilisateur connecté | À faire |

### Datacenter : backup

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/backup` | List vzdump backup schedule. | Sys.Audit sur / | Fait |
| POST | `/cluster/backup` | Create new vzdump backup job. | Sys.Modify sur / | À faire |
| GET | `/cluster/backup/{id}` | Read vzdump backup job definition. | Sys.Audit sur / | À faire |
| PUT | `/cluster/backup/{id}` | Update vzdump backup job definition. | Sys.Modify sur / | À faire |
| DELETE | `/cluster/backup/{id}` | Delete vzdump backup job definition. | Sys.Modify sur / | À faire |
| GET | `/cluster/backup/{id}/included_volumes` | Returns included guests and the backup status of their disks. Optimized to be used in ExtJS tree views. | Sys.Audit sur / | À faire |

### Datacenter : backup-info

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/backup-info` | Index for backup info related endpoints | non précisée | Hors périmètre |
| GET | `/cluster/backup-info/not-backed-up` | Shows all guests which are not covered by any backup job. | Sys.Audit sur / | Fait |

### Datacenter : firewall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/firewall` | Directory index. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/firewall/aliases` | List aliases | Sys.Audit sur / | Fait |
| POST | `/cluster/firewall/aliases` | Create IP or Network Alias. | Sys.Modify sur / | Fait |
| GET | `/cluster/firewall/aliases/{name}` | Read alias. | Sys.Audit sur / | À faire |
| PUT | `/cluster/firewall/aliases/{name}` | Update IP or Network alias. | Sys.Modify sur / | Fait |
| DELETE | `/cluster/firewall/aliases/{name}` | Remove IP or Network alias. | Sys.Modify sur / | Fait |
| GET | `/cluster/firewall/groups` | List security groups. | tout utilisateur connecté | Fait |
| POST | `/cluster/firewall/groups` | Create new security group. | Sys.Modify sur / | À faire |
| GET | `/cluster/firewall/groups/{group}` | List rules. | Sys.Audit sur / | À faire |
| POST | `/cluster/firewall/groups/{group}` | Create new rule. | Sys.Modify sur / | À faire |
| DELETE | `/cluster/firewall/groups/{group}` | Delete security group. | Sys.Modify sur / | À faire |
| GET | `/cluster/firewall/groups/{group}/{pos}` | Get single rule data. | Sys.Audit sur / | À faire |
| PUT | `/cluster/firewall/groups/{group}/{pos}` | Modify rule data. | Sys.Modify sur / | À faire |
| DELETE | `/cluster/firewall/groups/{group}/{pos}` | Delete rule. | Sys.Modify sur / | À faire |
| GET | `/cluster/firewall/ipset` | List IPSets | Sys.Audit sur / | Fait |
| POST | `/cluster/firewall/ipset` | Create new IPSet | Sys.Modify sur / | Fait |
| GET | `/cluster/firewall/ipset/{name}` | List IPSet content | Sys.Audit sur / | Fait |
| POST | `/cluster/firewall/ipset/{name}` | Add IP or Network to IPSet. | Sys.Modify sur / | Fait |
| DELETE | `/cluster/firewall/ipset/{name}` | Delete IPSet | Sys.Modify sur / | Fait |
| GET | `/cluster/firewall/ipset/{name}/{cidr}` | Read IP or Network settings from IPSet. | Sys.Audit sur / | À faire |
| PUT | `/cluster/firewall/ipset/{name}/{cidr}` | Update IP or Network settings | Sys.Modify sur / | À faire |
| DELETE | `/cluster/firewall/ipset/{name}/{cidr}` | Remove IP or Network from IPSet. | Sys.Modify sur / | Fait |
| GET | `/cluster/firewall/macros` | List available macros | tout utilisateur connecté | À faire |
| GET | `/cluster/firewall/options` | Get Firewall options. | Sys.Audit sur / | Fait |
| PUT | `/cluster/firewall/options` | Set Firewall options. | Sys.Modify sur / | Fait |
| GET | `/cluster/firewall/refs` | Lists possible IPSet/Alias reference which are allowed in source/dest properties. | Sys.Audit sur / | À faire |
| GET | `/cluster/firewall/rules` | List rules. | Sys.Audit sur / | Fait |
| POST | `/cluster/firewall/rules` | Create new rule. | Sys.Modify sur / | Fait |
| GET | `/cluster/firewall/rules/{pos}` | Get single rule data. | Sys.Audit sur / | À faire |
| PUT | `/cluster/firewall/rules/{pos}` | Modify rule data. | Sys.Modify sur / | Fait |
| DELETE | `/cluster/firewall/rules/{pos}` | Delete rule. | Sys.Modify sur / | Fait |

### Datacenter : jobs

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/jobs` | Index for jobs related endpoints. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/jobs/realm-sync` | List configured realm-sync-jobs. | Sys.Audit sur / | À faire |
| GET | `/cluster/jobs/realm-sync/{id}` | Read realm-sync job definition. | Sys.Audit sur / | À faire |
| POST | `/cluster/jobs/realm-sync/{id}` | Create new realm-sync job. | Realm.AllocateUser sur /access/realm/{realm} et User.Modify sur /access/groups | À faire |
| PUT | `/cluster/jobs/realm-sync/{id}` | Update realm-sync job definition. | Realm.AllocateUser sur /access/realm/{realm} et User.Modify sur /access/groups | À faire |
| DELETE | `/cluster/jobs/realm-sync/{id}` | Delete realm-sync job definition. | Sys.Modify sur / | À faire |
| GET | `/cluster/jobs/schedule-analyze` | Returns a list of future schedule runtimes. | tout utilisateur connecté | À faire |

### Datacenter : mapping

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/mapping` | List resource types. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/mapping/dir` | List directory mapping | Only lists entries where you have 'Mapping.Modify', 'Mapping.Use' or 'Mapping.Audit' permissions on '/mapping/dir/<id>'. | Fait |
| POST | `/cluster/mapping/dir` | Create a new directory mapping. | Mapping.Modify sur /mapping/dir | À faire |
| GET | `/cluster/mapping/dir/{id}` | Get directory mapping. | Mapping.Use sur /mapping/dir/{id} ou Mapping.Modify sur /mapping/dir/{id} ou Mapping.Audit sur /mapping/dir/{id} | À faire |
| PUT | `/cluster/mapping/dir/{id}` | Update a directory mapping. | Mapping.Modify sur /mapping/dir/{id} | À faire |
| DELETE | `/cluster/mapping/dir/{id}` | Remove directory mapping. | Mapping.Modify sur /mapping/dir | À faire |
| GET | `/cluster/mapping/pci` | List PCI Hardware Mapping | Only lists entries where you have 'Mapping.Modify', 'Mapping.Use' or 'Mapping.Audit' permissions on '/mapping/pci/<id>'. | Fait |
| POST | `/cluster/mapping/pci` | Create a new hardware mapping. | Mapping.Modify sur /mapping/pci | À faire |
| GET | `/cluster/mapping/pci/{id}` | Get PCI Mapping. | Mapping.Use sur /mapping/pci/{id} ou Mapping.Modify sur /mapping/pci/{id} ou Mapping.Audit sur /mapping/pci/{id} | À faire |
| PUT | `/cluster/mapping/pci/{id}` | Update a hardware mapping. | Mapping.Modify sur /mapping/pci/{id} | À faire |
| DELETE | `/cluster/mapping/pci/{id}` | Remove Hardware Mapping. | Mapping.Modify sur /mapping/pci | À faire |
| GET | `/cluster/mapping/usb` | List USB Hardware Mappings | Only lists entries where you have 'Mapping.Modify', 'Mapping.Use' or 'Mapping.Audit' permissions on '/mapping/usb/<id>'. | Fait |
| POST | `/cluster/mapping/usb` | Create a new hardware mapping. | Mapping.Modify sur /mapping/usb | À faire |
| GET | `/cluster/mapping/usb/{id}` | Get USB Mapping. | Mapping.Audit sur /mapping/usb/{id} ou Mapping.Use sur /mapping/usb/{id} ou Mapping.Modify sur /mapping/usb/{id} | À faire |
| PUT | `/cluster/mapping/usb/{id}` | Update a hardware mapping. | Mapping.Modify sur /mapping/usb/{id} | À faire |
| DELETE | `/cluster/mapping/usb/{id}` | Remove Hardware Mapping. | Mapping.Modify sur /mapping/usb | À faire |

### Datacenter : metrics

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/metrics` | Metrics index. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/metrics/export` | Retrieve metrics of the cluster. | Sys.Audit sur / | À faire |
| GET | `/cluster/metrics/server` | List configured metric servers. | Sys.Audit sur / | À faire |
| GET | `/cluster/metrics/server/{id}` | Read metric server configuration. | Sys.Audit sur / | À faire |
| POST | `/cluster/metrics/server/{id}` | Create a new external metric server config | Sys.Modify sur / | À faire |
| PUT | `/cluster/metrics/server/{id}` | Update metric server configuration. | Sys.Modify sur / | À faire |
| DELETE | `/cluster/metrics/server/{id}` | Remove Metric server. | Sys.Modify sur / | À faire |

### Datacenter : notifications

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/notifications` | Index for notification-related API endpoints. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/notifications/endpoints` | Index for all available endpoint types. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/notifications/endpoints/gotify` | Returns a list of all gotify endpoints | Mapping.Audit sur /mapping/notifications | À faire |
| POST | `/cluster/notifications/endpoints/gotify` | Create a new gotify endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| GET | `/cluster/notifications/endpoints/gotify/{name}` | Return a specific gotify endpoint | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| PUT | `/cluster/notifications/endpoints/gotify/{name}` | Update existing gotify endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| DELETE | `/cluster/notifications/endpoints/gotify/{name}` | Remove gotify endpoint | Mapping.Modify sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/endpoints/sendmail` | Returns a list of all sendmail endpoints | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| POST | `/cluster/notifications/endpoints/sendmail` | Create a new sendmail endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| GET | `/cluster/notifications/endpoints/sendmail/{name}` | Return a specific sendmail endpoint | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| PUT | `/cluster/notifications/endpoints/sendmail/{name}` | Update existing sendmail endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| DELETE | `/cluster/notifications/endpoints/sendmail/{name}` | Remove sendmail endpoint | Mapping.Modify sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/endpoints/smtp` | Returns a list of all smtp endpoints | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| POST | `/cluster/notifications/endpoints/smtp` | Create a new smtp endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| GET | `/cluster/notifications/endpoints/smtp/{name}` | Return a specific smtp endpoint | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| PUT | `/cluster/notifications/endpoints/smtp/{name}` | Update existing smtp endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| DELETE | `/cluster/notifications/endpoints/smtp/{name}` | Remove smtp endpoint | Mapping.Modify sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/endpoints/webhook` | Returns a list of all webhook endpoints | Mapping.Audit sur /mapping/notifications | À faire |
| POST | `/cluster/notifications/endpoints/webhook` | Create a new webhook endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| GET | `/cluster/notifications/endpoints/webhook/{name}` | Return a specific webhook endpoint | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| PUT | `/cluster/notifications/endpoints/webhook/{name}` | Update existing webhook endpoint | Mapping.Modify sur /mapping/notifications et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /) | À faire |
| DELETE | `/cluster/notifications/endpoints/webhook/{name}` | Remove webhook endpoint | Mapping.Modify sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/matcher-field-values` | Returns known notification metadata fields and their known values | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/matcher-fields` | Returns known notification metadata fields | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/matchers` | Returns a list of all matchers | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications ou Mapping.Use sur /mapping/notifications | À faire |
| POST | `/cluster/notifications/matchers` | Create a new matcher | Mapping.Modify sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/matchers/{name}` | Return a specific matcher | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications | À faire |
| PUT | `/cluster/notifications/matchers/{name}` | Update existing matcher | Mapping.Modify sur /mapping/notifications | À faire |
| DELETE | `/cluster/notifications/matchers/{name}` | Remove matcher | Mapping.Modify sur /mapping/notifications | À faire |
| GET | `/cluster/notifications/targets` | Returns a list of all entities that can be used as notification targets. | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications ou Mapping.Use sur /mapping/notifications | À faire |
| POST | `/cluster/notifications/targets/{name}/test` | Send a test notification to a provided target. | Mapping.Modify sur /mapping/notifications ou Mapping.Audit sur /mapping/notifications ou Mapping.Use sur /mapping/notifications | À faire |

### Datacenter : options

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/options` | Get datacenter options. Without 'Sys.Audit' on '/' not all options are returned. | Sys.Audit sur / | À faire |
| PUT | `/cluster/options` | Set datacenter options. | Sys.Modify sur / | À faire |

### Datacenter : qemu

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/qemu` | Cluster-wide QEMU index | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/qemu/cpu-flags` | List of available CPU flags. Currently only implemented for x86_64, returns an empty list for aarch64. | Sys.Audit sur /nodes ou Mapping.Audit ou Mapping.Use ou Mapping.Modify sur /mapping/cpu | À faire |
| GET | `/cluster/qemu/custom-cpu-models` | List all custom CPU model definitions visible to the user. | Only lists entries where the user has 'Mapping.Modify', 'Mapping.Use' or 'Mapping.Audit' permissions on '/mapping/cpu/<name>'. | À faire |
| POST | `/cluster/qemu/custom-cpu-models` | Add a custom CPU model definition. | Mapping.Modify sur /mapping/cpu | À faire |
| GET | `/cluster/qemu/custom-cpu-models/{cputype}` | Retrieve details about a specific custom CPU model. | Mapping.Audit sur /mapping/cpu/{cputype} ou Mapping.Use sur /mapping/cpu/{cputype} ou Mapping.Modify sur /mapping/cpu/{cputype} | À faire |
| PUT | `/cluster/qemu/custom-cpu-models/{cputype}` | Update a custom CPU model definition. | Mapping.Modify sur /mapping/cpu/{cputype} | À faire |
| DELETE | `/cluster/qemu/custom-cpu-models/{cputype}` | Delete a custom CPU model definition. | Mapping.Modify sur /mapping/cpu/{cputype} | À faire |

### Datacenter : sdn

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/sdn` | Directory index. | SDN.Audit sur /sdn | Hors périmètre |
| PUT | `/cluster/sdn` | Apply sdn controller changes && reload. | SDN.Allocate sur /sdn | À faire |
| GET | `/cluster/sdn/controllers` | SDN controllers index. | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/controllers/<controller>' | À faire |
| POST | `/cluster/sdn/controllers` | Create a new sdn controller object. | SDN.Allocate sur /sdn/controllers | À faire |
| GET | `/cluster/sdn/controllers/{controller}` | Read sdn controller configuration. | SDN.Allocate sur /sdn/controllers/{controller} | À faire |
| PUT | `/cluster/sdn/controllers/{controller}` | Update sdn controller object configuration. | SDN.Allocate sur /sdn/controllers | À faire |
| DELETE | `/cluster/sdn/controllers/{controller}` | Delete sdn controller object configuration. | SDN.Allocate sur /sdn/controllers | À faire |
| GET | `/cluster/sdn/dns` | SDN dns index. | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/dns/<dns>' | À faire |
| POST | `/cluster/sdn/dns` | Create a new sdn dns object. | SDN.Allocate sur /sdn/dns | À faire |
| GET | `/cluster/sdn/dns/{dns}` | Read sdn dns configuration. | SDN.Allocate sur /sdn/dns/{dns} | À faire |
| PUT | `/cluster/sdn/dns/{dns}` | Update sdn dns object configuration. | SDN.Allocate sur /sdn/dns | À faire |
| DELETE | `/cluster/sdn/dns/{dns}` | Delete sdn dns object configuration. | SDN.Allocate sur /sdn/dns | À faire |
| GET | `/cluster/sdn/dry-run` | Dry-run the SDN apply action and return the difference between the current configuration and the pending configuration | Sys.Audit sur /nodes/{node} | À faire |
| GET | `/cluster/sdn/fabrics` | SDN Fabrics Index | SDN.Audit sur /sdn/fabrics | Hors périmètre |
| GET | `/cluster/sdn/fabrics/all` | SDN Fabrics Index | Only list fabrics where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/fabrics/<fabric>', only list nodes where you have 'Sys.Audit' or 'Sys.Modif… | À faire |
| GET | `/cluster/sdn/fabrics/fabric` | SDN Fabrics Index | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/fabrics/<fabric>' | À faire |
| POST | `/cluster/sdn/fabrics/fabric` | Add a fabric | SDN.Allocate sur /sdn/fabrics | À faire |
| GET | `/cluster/sdn/fabrics/fabric/{id}` | Update a fabric | SDN.Audit ou SDN.Allocate sur /sdn/fabrics/{id} | À faire |
| PUT | `/cluster/sdn/fabrics/fabric/{id}` | Update a fabric | SDN.Allocate sur /sdn/fabrics/{id} | À faire |
| DELETE | `/cluster/sdn/fabrics/fabric/{id}` | Add a fabric | SDN.Allocate sur /sdn/fabrics/{id} | À faire |
| GET | `/cluster/sdn/fabrics/node` | SDN Fabrics Index | Only list nodes where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/fabrics/<fabric>' and 'Sys.Audit' or 'Sys.Modify' on /nodes/<node_id> | À faire |
| GET | `/cluster/sdn/fabrics/node/{fabric_id}` | SDN Fabrics Index | SDN.Audit sur /sdn/fabrics/{fabric_id} | À faire |
| POST | `/cluster/sdn/fabrics/node/{fabric_id}` | Add a node | SDN.Allocate sur /sdn/fabrics/{fabric_id} et Sys.Modify sur /nodes/{node_id} | À faire |
| GET | `/cluster/sdn/fabrics/node/{fabric_id}/{node_id}` | Get a node | SDN.Audit ou SDN.Allocate sur /sdn/fabrics/{fabric_id} et Sys.Audit ou Sys.Modify sur /nodes/{node_id} | À faire |
| PUT | `/cluster/sdn/fabrics/node/{fabric_id}/{node_id}` | Update a node | SDN.Allocate sur /sdn/fabrics/{fabric_id} et Sys.Modify sur /nodes/{node_id} | À faire |
| DELETE | `/cluster/sdn/fabrics/node/{fabric_id}/{node_id}` | Add a node | SDN.Allocate sur /sdn/fabrics/{fabric_id} et Sys.Modify sur /nodes/{node_id} | À faire |
| GET | `/cluster/sdn/ipams` | SDN ipams index. | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/ipams/<ipam>' | À faire |
| POST | `/cluster/sdn/ipams` | Create a new sdn ipam object. | SDN.Allocate sur /sdn/ipams | À faire |
| GET | `/cluster/sdn/ipams/{ipam}` | Read sdn ipam configuration. | SDN.Allocate sur /sdn/ipams/{ipam} | À faire |
| PUT | `/cluster/sdn/ipams/{ipam}` | Update sdn ipam object configuration. | SDN.Allocate sur /sdn/ipams | À faire |
| DELETE | `/cluster/sdn/ipams/{ipam}` | Delete sdn ipam object configuration. | SDN.Allocate sur /sdn/ipams | À faire |
| GET | `/cluster/sdn/ipams/{ipam}/status` | List PVE IPAM Entries | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| POST | `/cluster/sdn/lock` | Acquire global lock for SDN configuration | SDN.Allocate sur /sdn | À faire |
| DELETE | `/cluster/sdn/lock` | Release global lock for SDN configuration | SDN.Allocate sur /sdn | À faire |
| GET | `/cluster/sdn/prefix-lists` | List Prefix Lists | Only returns prefix list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions. | À faire |
| POST | `/cluster/sdn/prefix-lists` | Create Prefix List | SDN.Allocate sur /sdn/prefix-lists | À faire |
| GET | `/cluster/sdn/prefix-lists/{id}` | Get Prefix List | SDN.Audit sur /sdn/prefix-lists/{id} | À faire |
| PUT | `/cluster/sdn/prefix-lists/{id}` | Update Prefix List | SDN.Allocate sur /sdn/prefix-lists/{id} | À faire |
| DELETE | `/cluster/sdn/prefix-lists/{id}` | Delete Prefix List | SDN.Allocate sur /sdn/prefix-lists/{id} | À faire |
| GET | `/cluster/sdn/prefix-lists/{id}/entries` | List Prefix List Entries | SDN.Audit sur /sdn/prefix-lists/{id} | À faire |
| POST | `/cluster/sdn/prefix-lists/{id}/entries` | Create Prefix List Entry | SDN.Allocate sur /sdn/prefix-lists/{id} | À faire |
| GET | `/cluster/sdn/prefix-lists/{id}/entries/{url_seq}` | Get Prefix List Entry | SDN.Audit sur /sdn/prefix-lists/{id} | À faire |
| PUT | `/cluster/sdn/prefix-lists/{id}/entries/{url_seq}` | Update Prefix List Entry | SDN.Allocate sur /sdn/prefix-lists/{id} | À faire |
| DELETE | `/cluster/sdn/prefix-lists/{id}/entries/{url_seq}` | Delete Prefix List Entry | SDN.Allocate sur /sdn/prefix-lists/{id} | À faire |
| POST | `/cluster/sdn/rollback` | Rollback pending changes to SDN configuration | SDN.Allocate sur /sdn | À faire |
| GET | `/cluster/sdn/route-maps` | List Route Maps | Only returns route maps where you have 'SDN.Audit' or 'SDN.Allocate' permissions. | À faire |
| GET | `/cluster/sdn/route-maps/entries` | Lists all route map entries. | Only returns route map entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions. | À faire |
| POST | `/cluster/sdn/route-maps/entries` | Create Route Map entry | SDN.Allocate sur /sdn/route-maps | À faire |
| GET | `/cluster/sdn/route-maps/entries/{route-map-id}` | List all entries for a given Route Map | SDN.Audit ou SDN.Allocate sur /sdn/route-maps/{route-map-id} | À faire |
| GET | `/cluster/sdn/route-maps/entries/{route-map-id}/entry/{order}` | Get Route Map Entry | SDN.Audit ou SDN.Allocate sur /sdn/route-maps/{route-map-id} | À faire |
| PUT | `/cluster/sdn/route-maps/entries/{route-map-id}/entry/{order}` | Update Route Map Entry | SDN.Allocate sur /sdn/route-maps/{route-map-id} | À faire |
| DELETE | `/cluster/sdn/route-maps/entries/{route-map-id}/entry/{order}` | Delete Route Map Entry | SDN.Allocate sur /sdn/route-maps/{route-map-id} | À faire |
| GET | `/cluster/sdn/vnets` | SDN vnets index. | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| POST | `/cluster/sdn/vnets` | Create a new sdn vnet object. | SDN.Allocate sur /sdn/zones/{zone} | À faire |
| GET | `/cluster/sdn/vnets/{vnet}` | Read sdn vnet configuration. | Require 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| PUT | `/cluster/sdn/vnets/{vnet}` | Update sdn vnet object configuration. | Require 'SDN.Allocate' permission on '/sdn/zones/<zone>/<vnet>' | À faire |
| DELETE | `/cluster/sdn/vnets/{vnet}` | Delete sdn vnet object configuration. | Require 'SDN.Allocate' permission on '/sdn/zones/<zone>/<vnet>' | À faire |
| GET | `/cluster/sdn/vnets/{vnet}/firewall` | Directory index. | non précisée | Hors périmètre |
| GET | `/cluster/sdn/vnets/{vnet}/firewall/options` | Get vnet firewall options. | Needs SDN.Audit or SDN.Allocate permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| PUT | `/cluster/sdn/vnets/{vnet}/firewall/options` | Set Firewall options. | Needs SDN.Allocate permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| GET | `/cluster/sdn/vnets/{vnet}/firewall/rules` | List rules. | Needs SDN.Audit or SDN.Allocate permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| POST | `/cluster/sdn/vnets/{vnet}/firewall/rules` | Create new rule. | Needs SDN.Allocate permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| GET | `/cluster/sdn/vnets/{vnet}/firewall/rules/{pos}` | Get single rule data. | Needs SDN.Audit or SDN.Allocate permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| PUT | `/cluster/sdn/vnets/{vnet}/firewall/rules/{pos}` | Modify rule data. | Needs SDN.Allocate permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| DELETE | `/cluster/sdn/vnets/{vnet}/firewall/rules/{pos}` | Delete rule. | Needs SDN.Allocate permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| POST | `/cluster/sdn/vnets/{vnet}/ips` | Create IP Mapping in a VNet | SDN.Allocate sur /sdn/zones/{zone}/{vnet} | À faire |
| PUT | `/cluster/sdn/vnets/{vnet}/ips` | Update IP Mapping in a VNet | SDN.Allocate sur /sdn/zones/{zone}/{vnet} | À faire |
| DELETE | `/cluster/sdn/vnets/{vnet}/ips` | Delete IP Mappings in a VNet | SDN.Allocate sur /sdn/zones/{zone}/{vnet} | À faire |
| GET | `/cluster/sdn/vnets/{vnet}/subnets` | SDN subnets index. | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| POST | `/cluster/sdn/vnets/{vnet}/subnets` | Create a new sdn subnet object. | Require 'SDN.Allocate' permission on '/sdn/zones/<zone>/<vnet>' | À faire |
| GET | `/cluster/sdn/vnets/{vnet}/subnets/{subnet}` | Read sdn subnet configuration. | Require 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| PUT | `/cluster/sdn/vnets/{vnet}/subnets/{subnet}` | Update sdn subnet object configuration. | Require 'SDN.Allocate' permission on '/sdn/zones/<zone>/<vnet>' | À faire |
| DELETE | `/cluster/sdn/vnets/{vnet}/subnets/{subnet}` | Delete sdn subnet object configuration. | Require 'SDN.Allocate' permission on '/sdn/zones/<zone>/<vnet>' | À faire |
| GET | `/cluster/sdn/zones` | SDN zones index. | Only list entries where you have 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/zones/<zone>' | À faire |
| POST | `/cluster/sdn/zones` | Create a new sdn zone object. | SDN.Allocate sur /sdn/zones | À faire |
| GET | `/cluster/sdn/zones/{zone}` | Read sdn zone configuration. | SDN.Allocate sur /sdn/zones/{zone} | À faire |
| PUT | `/cluster/sdn/zones/{zone}` | Update sdn zone object configuration. | SDN.Allocate sur /sdn/zones/{zone} | À faire |
| DELETE | `/cluster/sdn/zones/{zone}` | Delete sdn zone object configuration. | SDN.Allocate sur /sdn/zones/{zone} | À faire |

### Datacenter : version

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/version` | API version details, including some parts of the global datacenter config. | tout utilisateur connecté | À faire |

## Cluster

60 points d'entrée : 9 faits, 42 à faire, 9 hors périmètre.

### Cluster : (racine)

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster` | Cluster index. | tout utilisateur connecté | Hors périmètre |

### Cluster : bulk-action

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/bulk-action` | List resource types. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/bulk-action/guest` | Bulk action index. | tout utilisateur connecté | Hors périmètre |
| POST | `/cluster/bulk-action/guest/migrate` | Bulk migrate all guests on the cluster. | The 'VM.Migrate' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. | À faire |
| POST | `/cluster/bulk-action/guest/shutdown` | Bulk shutdown all guests on the cluster. | The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. | À faire |
| POST | `/cluster/bulk-action/guest/start` | Bulk start or resume all guests on the cluster. | The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. | À faire |
| POST | `/cluster/bulk-action/guest/suspend` | Bulk suspend all guests on the cluster. | The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. Additionally, you need 'VM.Config.Disk' on the '… | À faire |

### Cluster : ceph

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/ceph` | Cluster ceph index. | tout utilisateur connecté | Hors périmètre |
| GET | `/cluster/ceph/flags` | get the status of all ceph flags | Sys.Audit sur / | À faire |
| PUT | `/cluster/ceph/flags` | Set/Unset multiple Ceph flags at once. Each flag is a top-level optional boolean: passing true sets the flag, false unsets it, omitting it leaves the current state untouched. Runs as a worker task; returns a UPID to fol… | Sys.Modify sur / | À faire |
| GET | `/cluster/ceph/flags/{flag}` | Get the status of a specific ceph flag. | Sys.Audit sur / | À faire |
| PUT | `/cluster/ceph/flags/{flag}` | Set or clear (unset) a specific Ceph flag. Runs synchronously (unlike the bulk PUT /cluster/ceph/flags endpoint, which forks a worker task). | Sys.Modify sur / | À faire |
| GET | `/cluster/ceph/health-mute` | Get the currently muted Ceph health checks. | Sys.Audit ou Datastore.Audit sur / | À faire |
| PUT | `/cluster/ceph/health-mute/{code}` | Mute or unmute a Ceph health check. A muted check no longer counts towards the cluster status, but stays visible and keeps being evaluated. | Sys.Modify sur / | À faire |
| GET | `/cluster/ceph/metadata` | Get ceph metadata. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/cluster/ceph/restart-bulk` | Cluster-wide rolling restart of all Ceph daemons of the given type. For MON/MGR/MDS each daemon is restarted only after Ceph reports the previous one is back up and the next one is safe to stop. For OSDs the cluster pat… | Sys.Modify sur / | À faire |
| GET | `/cluster/ceph/status` | Get ceph status. | Sys.Audit ou Datastore.Audit sur / | À faire |

### Cluster : config

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/config` | Directory index. | Sys.Audit sur / | Hors périmètre |
| POST | `/cluster/config` | Generate new cluster configuration. If no links given, default to local IP address as link0. | non précisée | À faire |
| GET | `/cluster/config/apiversion` | Return the version of the cluster join API available on this node. | Sys.Audit sur / | Hors périmètre |
| GET | `/cluster/config/join` | Get information needed to join this cluster over the connected node. | Sys.Audit sur / | À faire |
| POST | `/cluster/config/join` | Joins this node into an existing cluster. If no links are given, default to IP resolved by node's hostname on single link (fallback fails for clusters with multiple links). | non précisée | À faire |
| GET | `/cluster/config/nodes` | Corosync node list. | Sys.Audit sur / | À faire |
| POST | `/cluster/config/nodes/{node}` | Adds a node to the cluster configuration. This call is for internal use. | non précisée | Hors périmètre |
| DELETE | `/cluster/config/nodes/{node}` | Removes a node from the cluster configuration. | non précisée | À faire |
| GET | `/cluster/config/qdevice` | Get QDevice status | Sys.Audit sur / | À faire |
| GET | `/cluster/config/totem` | Get corosync totem protocol settings. | Sys.Audit sur / | À faire |

### Cluster : ha

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/ha` | Directory index. | Sys.Audit sur / | Hors périmètre |
| GET | `/cluster/ha/groups` | Get HA groups. (deprecated in favor of HA rules) | Sys.Audit sur / | À faire |
| POST | `/cluster/ha/groups` | Create a new HA group. (deprecated in favor of HA rules) | Sys.Console sur / | À faire |
| GET | `/cluster/ha/groups/{group}` | Read ha group configuration. (deprecated in favor of HA rules) | Sys.Audit sur / | À faire |
| PUT | `/cluster/ha/groups/{group}` | Update ha group configuration. (deprecated in favor of HA rules) | Sys.Console sur / | À faire |
| DELETE | `/cluster/ha/groups/{group}` | Delete ha group configuration. (deprecated in favor of HA rules) | Sys.Console sur / | À faire |
| GET | `/cluster/ha/resources` | List HA resources. | Sys.Audit sur / | Fait |
| POST | `/cluster/ha/resources` | Create a new HA resource. | Sys.Console sur / | À faire |
| GET | `/cluster/ha/resources/{sid}` | Read resource configuration. | Sys.Audit sur / | À faire |
| PUT | `/cluster/ha/resources/{sid}` | Update resource configuration. | Sys.Console sur / | À faire |
| DELETE | `/cluster/ha/resources/{sid}` | Delete resource configuration. | Sys.Console sur / | À faire |
| POST | `/cluster/ha/resources/{sid}/migrate` | Request resource migration (online) to another node. | Sys.Console sur / | À faire |
| POST | `/cluster/ha/resources/{sid}/relocate` | Request resource relocation to another node. This stops the service on the old node, and restarts it on the target node. | Sys.Console sur / | À faire |
| GET | `/cluster/ha/rules` | Get HA rules. | Sys.Audit sur / | À faire |
| POST | `/cluster/ha/rules` | Create HA rule. | Sys.Console sur / | À faire |
| GET | `/cluster/ha/rules/{rule}` | Read HA rule. | Sys.Audit sur / | À faire |
| PUT | `/cluster/ha/rules/{rule}` | Update HA rule. | Sys.Console sur / | À faire |
| DELETE | `/cluster/ha/rules/{rule}` | Delete HA rule. | Sys.Console sur / | À faire |
| GET | `/cluster/ha/status` | Directory index. | tout utilisateur connecté | Hors périmètre |
| POST | `/cluster/ha/status/arm-ha` | Request re-arming the HA stack after it was disarmed. | Sys.Console sur / | À faire |
| GET | `/cluster/ha/status/current` | Get HA manager status. | Sys.Audit sur / | Fait |
| POST | `/cluster/ha/status/disarm-ha` | Request disarming the HA stack, releasing all watchdogs cluster-wide. | Sys.Console sur / | À faire |
| GET | `/cluster/ha/status/manager_status` | Get full HA manager status, including LRM status. | Sys.Audit sur / | À faire |

### Cluster : log

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/log` | Read cluster log | The user needs 'Sys.Syslog' on '/' in order to get all logs. | À faire |

### Cluster : nextid

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/nextid` | Get next free VMID. Pass a VMID to assert that its free (at time of check). | tout utilisateur connecté | Fait |

### Cluster : replication

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/replication` | List replication jobs. | Will only return replication jobs for which the calling user has VM.Audit permission on /vms/<vmid>. | À faire |
| POST | `/cluster/replication` | Create a new replication job | Requires the VM.Replicate permission on /vms/<vmid>. | Fait |
| GET | `/cluster/replication/{id}` | Read replication job configuration. | Requires the VM.Audit permission on /vms/<vmid>. | À faire |
| PUT | `/cluster/replication/{id}` | Update replication job configuration. | Requires the VM.Replicate permission on /vms/<vmid>. | Fait |
| DELETE | `/cluster/replication/{id}` | Mark replication job for removal. | Requires the VM.Replicate permission on /vms/<vmid>. | Fait |

### Cluster : resources

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/resources` | Resources index (cluster wide). | tout utilisateur connecté | Fait |

### Cluster : status

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/status` | Get cluster status information. | Sys.Audit sur / | Fait |

### Cluster : tasks

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/cluster/tasks` | List recent tasks (cluster wide). | tout utilisateur connecté | Fait |

## Nœud

173 points d'entrée : 35 faits, 116 à faire, 22 hors périmètre.

### Nœud : (racine)

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes` | Cluster node index. | tout utilisateur connecté | Fait |
| GET | `/nodes/{node}` | Node index. | tout utilisateur connecté | Hors périmètre |

### Nœud : aplinfo

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/aplinfo` | Get list of appliances. | tout utilisateur connecté | Fait |
| POST | `/nodes/{node}/aplinfo` | Download appliance templates. | Datastore.AllocateTemplate sur /storage/{storage} | Fait |

### Nœud : apt

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/apt` | Directory index for apt (Advanced Package Tool). | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/apt/changelog` | Get package changelogs. | Sys.Modify sur /nodes/{node} | À faire |
| GET | `/nodes/{node}/apt/repositories` | Get APT repository information. | Sys.Audit sur /nodes/{node} | À faire |
| POST | `/nodes/{node}/apt/repositories` | Change the properties of a repository. Currently only allows enabling/disabling. | Sys.Modify sur /nodes/{node} | À faire |
| PUT | `/nodes/{node}/apt/repositories` | Add a standard repository to the configuration | Sys.Modify sur /nodes/{node} | À faire |
| GET | `/nodes/{node}/apt/update` | List available updates. | Sys.Modify sur /nodes/{node} | Fait |
| POST | `/nodes/{node}/apt/update` | This is used to resynchronize the package index files from their sources (apt-get update). | Sys.Modify sur /nodes/{node} | À faire |
| GET | `/nodes/{node}/apt/versions` | Get package information for important Proxmox packages. | Sys.Audit sur /nodes/{node} | À faire |

### Nœud : capabilities

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/capabilities` | Node capabilities index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/capabilities/qemu` | QEMU capabilities index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/capabilities/qemu/cpu` | List all custom and default CPU models. | Custom models are filtered to those the current user has any of Mapping.{Audit,Use,Modify} on /mapping/cpu/<name>; Sys.Audit on /nodes continues to grant visib… | Fait |
| GET | `/nodes/{node}/capabilities/qemu/cpu-flags` | List of available VM-specific CPU flags. Returns an empty list for 'aarch64' as no VM-specific flags are defined for it yet. | tout utilisateur connecté | À faire |
| GET | `/nodes/{node}/capabilities/qemu/machines` | Get available QEMU/KVM machine types. | tout utilisateur connecté | Fait |
| GET | `/nodes/{node}/capabilities/qemu/migration` | Get node-specific QEMU migration capabilities of the node. Requires the 'Sys.Audit' permission on '/nodes/<node>'. | Sys.Audit sur /nodes/{node} | À faire |

### Nœud : ceph

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/ceph` | Directory index. | Sys.Audit ou Datastore.Audit sur / | Hors périmètre |
| GET | `/nodes/{node}/ceph/cfg` | Directory index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/ceph/cfg/db` | Get the Ceph configuration database. | Sys.Audit ou Datastore.Audit sur / | À faire |
| GET | `/nodes/{node}/ceph/cfg/raw` | Get the Ceph configuration file. | Sys.Audit ou Datastore.Audit sur / | À faire |
| GET | `/nodes/{node}/ceph/cfg/value` | Get configured values from either ceph.conf or the mon config DB. Underscores in section and key names are normalised to hyphens in the response, regardless of how they're written in the source. | Sys.Audit sur / | À faire |
| GET | `/nodes/{node}/ceph/cmd-safety` | Heuristical check if it is safe to perform an action. | Sys.Audit sur / | À faire |
| GET | `/nodes/{node}/ceph/crush` | Get OSD crush map | Sys.Audit ou Datastore.Audit sur / | À faire |
| GET | `/nodes/{node}/ceph/fs` | Directory index. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/fs/{name}` | Create a Ceph filesystem | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/ceph/fs/{name}` | Destroy a Ceph filesystem. Refuses if any PVE storage entry of type 'cephfs' still references the filesystem and is not disabled. Optionally also removes the storage entries and/or the underlying metadata and data pools. | Sys.Modify sur / | À faire |
| POST | `/nodes/{node}/ceph/init` | Create the initial Ceph default configuration and set up symlinks. Idempotent on re-call: if a [global] section already exists in ceph.conf, the existing fsid / auth / pool defaults are preserved and most parameters are… | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/log` | Read ceph log | Sys.Syslog sur /nodes/{node} | À faire |
| GET | `/nodes/{node}/ceph/mds` | MDS directory index. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/mds/{name}` | Create Ceph Metadata Server (MDS) | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/ceph/mds/{name}` | Destroy Ceph Metadata Server | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/mgr` | MGR directory index. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/mgr/{id}` | Create Ceph Manager | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/ceph/mgr/{id}` | Destroy Ceph Manager. | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/mon` | Get Ceph monitor list. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/mon/{monid}` | Create a Ceph Monitor. Also auto-creates a Manager for the first monitor. | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/ceph/mon/{monid}` | Destroy a Ceph Monitor. Refuses to remove the last monitor of the cluster. Does not destroy any Manager on the same node; use /nodes/{node}/ceph/mgr/{id} for that. | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/osd` | Get Ceph osd list/tree. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/osd` | Create OSD | non précisée | À faire |
| GET | `/nodes/{node}/ceph/osd/{osdid}` | OSD index. | tout utilisateur connecté | Hors périmètre |
| DELETE | `/nodes/{node}/ceph/osd/{osdid}` | Destroy OSD | non précisée | À faire |
| POST | `/nodes/{node}/ceph/osd/{osdid}/in` | ceph osd in | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/osd/{osdid}/lv-info` | Get OSD volume details | Sys.Audit sur / | À faire |
| GET | `/nodes/{node}/ceph/osd/{osdid}/metadata` | Get OSD details | Sys.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/osd/{osdid}/out` | ceph osd out | Sys.Modify sur / | À faire |
| POST | `/nodes/{node}/ceph/osd/{osdid}/scrub` | Instruct the OSD to scrub. | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/pool` | List all pools and their settings (which are settable by the POST/PUT endpoints). | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/pool` | Create Ceph pool | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/pool/{name}` | Pool index. | Sys.Audit ou Datastore.Audit sur / | Hors périmètre |
| PUT | `/nodes/{node}/ceph/pool/{name}` | Change POOL settings | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/ceph/pool/{name}` | Destroy pool | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/pool/{name}/status` | Show the current pool status. | Sys.Audit ou Datastore.Audit sur / | À faire |
| GET | `/nodes/{node}/ceph/releases` | List all known Ceph releases, marking which ones can be installed on this node. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/restart` | Restart ceph services. | Sys.Modify sur / | À faire |
| POST | `/nodes/{node}/ceph/restart-bulk` | Rolling restart of all Ceph OSDs on this node. Each OSD is restarted only after Ceph reports the previous one is back up and the next one is safe to stop. For non-OSD Ceph daemons, use the cluster-wide endpoint at /clus… | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/rules` | List ceph rules. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/start` | Start ceph services. | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/ceph/status` | Get the Ceph cluster status (raw 'ceph status' output). The response is cluster-wide and identical to /cluster/ceph/status; this node-level alias exists for operator convenience. | Sys.Audit ou Datastore.Audit sur / | À faire |
| POST | `/nodes/{node}/ceph/stop` | Stop ceph services. | Sys.Modify sur / | À faire |

### Nœud : certificates

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/certificates` | Node index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/certificates/acme` | ACME index. | tout utilisateur connecté | Hors périmètre |
| POST | `/nodes/{node}/certificates/acme/certificate` | Order a new certificate from ACME-compatible CA. | Sys.Modify sur /nodes/{node} | À faire |
| PUT | `/nodes/{node}/certificates/acme/certificate` | Renew existing certificate from CA. | Sys.Modify sur /nodes/{node} | À faire |
| DELETE | `/nodes/{node}/certificates/acme/certificate` | Revoke existing certificate from CA. | Sys.Modify sur /nodes/{node} | À faire |
| POST | `/nodes/{node}/certificates/custom` | Upload or update custom certificate chain and key. | Sys.Modify sur /nodes/{node} | À faire |
| DELETE | `/nodes/{node}/certificates/custom` | DELETE custom certificate chain and key. | Sys.Modify sur /nodes/{node} | À faire |
| GET | `/nodes/{node}/certificates/info` | Get information about node's certificates. | tout utilisateur connecté | Fait |

### Nœud : config

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/config` | Get node configuration options. | Sys.Audit sur / | À faire |
| PUT | `/nodes/{node}/config` | Set node configuration options. | Sys.Modify sur / | À faire |

### Nœud : disks

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/disks` | Node index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/disks/directory` | PVE Managed Directory storages. | Sys.Audit sur / | À faire |
| POST | `/nodes/{node}/disks/directory` | Create a Filesystem on an unused disk. Will be mounted under '/mnt/pve/NAME'. | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/disks/directory/{name}` | Unmounts the storage and removes the mount unit. | Sys.Modify sur / | À faire |
| POST | `/nodes/{node}/disks/initgpt` | Initialize Disk with GPT | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/disks/list` | List local disks. | Sys.Audit sur / ou Sys.Audit sur /nodes/{node} | Fait |
| GET | `/nodes/{node}/disks/lvm` | List LVM Volume Groups | Sys.Audit sur / | À faire |
| POST | `/nodes/{node}/disks/lvm` | Create an LVM Volume Group | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/disks/lvm/{name}` | Remove an LVM Volume Group. | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/disks/lvmthin` | List LVM thinpools | Sys.Audit sur / | À faire |
| POST | `/nodes/{node}/disks/lvmthin` | Create an LVM thinpool | Sys.Modify sur / | À faire |
| DELETE | `/nodes/{node}/disks/lvmthin/{name}` | Remove an LVM thin pool. | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/disks/smart` | Get SMART Health of a disk. | Sys.Audit sur / | Fait |
| PUT | `/nodes/{node}/disks/wipedisk` | Wipe a disk or partition. | non précisée | À faire |
| GET | `/nodes/{node}/disks/zfs` | List Zpools. | Sys.Audit sur / | Fait |
| POST | `/nodes/{node}/disks/zfs` | Create a ZFS pool. | Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/disks/zfs/{name}` | Get details about a zpool. | Sys.Audit sur / | À faire |
| DELETE | `/nodes/{node}/disks/zfs/{name}` | Destroy a ZFS pool. | Sys.Modify sur / | À faire |

### Nœud : dns

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/dns` | Read DNS settings. | Sys.Audit sur /nodes/{node} | Fait |
| PUT | `/nodes/{node}/dns` | Write DNS settings. | Sys.Modify sur /nodes/{node} | À faire |

### Nœud : execute

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/execute` | Execute multiple commands in order, root only. | non précisée | Hors périmètre |

### Nœud : firewall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/firewall` | Directory index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/firewall/log` | Read firewall log | Sys.Syslog sur /nodes/{node} | Fait |
| GET | `/nodes/{node}/firewall/options` | Get host firewall options. | Sys.Audit sur /nodes/{node} | Fait |
| PUT | `/nodes/{node}/firewall/options` | Set Firewall options. | Sys.Modify sur /nodes/{node} | Fait |
| GET | `/nodes/{node}/firewall/rules` | List rules. | Sys.Audit sur /nodes/{node} | Fait |
| POST | `/nodes/{node}/firewall/rules` | Create new rule. | Sys.Modify sur /nodes/{node} | Fait |
| GET | `/nodes/{node}/firewall/rules/{pos}` | Get single rule data. | Sys.Audit sur /nodes/{node} | À faire |
| PUT | `/nodes/{node}/firewall/rules/{pos}` | Modify rule data. | Sys.Modify sur /nodes/{node} | Fait |
| DELETE | `/nodes/{node}/firewall/rules/{pos}` | Delete rule. | Sys.Modify sur /nodes/{node} | Fait |

### Nœud : hardware

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/hardware` | Index of hardware types | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/hardware/pci` | List local PCI devices. | Sys.Audit ou Sys.Modify sur / | Fait |
| GET | `/nodes/{node}/hardware/pci/{pci-id-or-mapping}` | Index of available pci methods | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/hardware/pci/{pci-id-or-mapping}/mdev` | List mediated device types for given PCI device. | Sys.Audit ou Sys.Modify sur / | À faire |
| GET | `/nodes/{node}/hardware/usb` | List local USB devices. | Sys.Modify sur / | Fait |

### Nœud : hosts

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/hosts` | Get the content of /etc/hosts. | Sys.Audit sur / | À faire |
| POST | `/nodes/{node}/hosts` | Write /etc/hosts. | Sys.Modify sur /nodes/{node} | À faire |

### Nœud : journal

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/journal` | Read Journal | Sys.Syslog sur /nodes/{node} | À faire |

### Nœud : migrateall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/migrateall` | Migrate all VMs and Containers. | The 'VM.Migrate' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. | À faire |

### Nœud : netstat

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/netstat` | Read tap/vm network device interface counters | Sys.Audit sur /nodes/{node} | Fait |

### Nœud : network

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/network` | List available networks | tout utilisateur connecté | Fait |
| POST | `/nodes/{node}/network` | Create network device configuration | Sys.Modify sur /nodes/{node} | À faire |
| PUT | `/nodes/{node}/network` | Reload network configuration | Sys.Modify sur /nodes/{node} | À faire |
| DELETE | `/nodes/{node}/network` | Revert network configuration changes. | Sys.Modify sur /nodes/{node} | À faire |
| GET | `/nodes/{node}/network/{iface}` | Read network device configuration | Sys.Audit sur /nodes/{node} | À faire |
| PUT | `/nodes/{node}/network/{iface}` | Update network device configuration | Sys.Modify sur /nodes/{node} | À faire |
| DELETE | `/nodes/{node}/network/{iface}` | Delete network device configuration | Sys.Modify sur /nodes/{node} | À faire |

### Nœud : query-oci-repo-tags

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/query-oci-repo-tags` | List all tags for an OCI repository reference. | Sys.AccessNetwork sur /nodes/{node} | À faire |

### Nœud : query-url-metadata

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/query-url-metadata` | Query metadata of an URL: file size, file name and mime type. | Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /nodes/{node} | À faire |

### Nœud : replication

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/replication` | List status of all replication jobs on this node. | Requires the VM.Audit permission on /vms/<vmid>. | Fait |
| GET | `/nodes/{node}/replication/{id}` | Directory index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/replication/{id}/log` | Read replication job log. | Requires the VM.Audit permission on /vms/<vmid>, or 'Sys.Audit' on '/nodes/<node>' | Fait |
| POST | `/nodes/{node}/replication/{id}/schedule_now` | Schedule replication job to start as soon as possible. | Requires the VM.Replicate permission on /vms/<vmid>. | Fait |
| GET | `/nodes/{node}/replication/{id}/status` | Get replication job status. | Requires the VM.Audit permission on /vms/<vmid>. | À faire |

### Nœud : report

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/report` | Gather various systems information about a node | Sys.Audit sur /nodes/{node} | À faire |

### Nœud : rrd

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/rrd` | Read node RRD statistics (returns PNG) | Sys.Audit sur /nodes/{node} | À faire |

### Nœud : rrddata

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/rrddata` | Read node RRD statistics | Sys.Audit sur /nodes/{node} | Fait |

### Nœud : sdn

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/sdn` | SDN index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/sdn/fabrics/{fabric}` | Directory index for SDN fabric status. | SDN.Audit sur /sdn/fabrics/{fabric} | Hors périmètre |
| GET | `/nodes/{node}/sdn/fabrics/{fabric}/interfaces` | Get all interfaces for a fabric. | SDN.Audit sur /sdn/fabrics/{fabric} | À faire |
| GET | `/nodes/{node}/sdn/fabrics/{fabric}/neighbors` | Get all neighbors for a fabric. | SDN.Audit sur /sdn/fabrics/{fabric} | À faire |
| GET | `/nodes/{node}/sdn/fabrics/{fabric}/routes` | Get all routes for a fabric. | SDN.Audit sur /sdn/fabrics/{fabric} | À faire |
| GET | `/nodes/{node}/sdn/vnets/{vnet}` | (sans description) | Require 'SDN.Audit' permissions on '/sdn/zones/<zone>/<vnet>' | Hors périmètre |
| GET | `/nodes/{node}/sdn/vnets/{vnet}/mac-vrf` | Get the MAC VRF for a VNet in an EVPN zone. | Require 'SDN.Audit' permissions on '/sdn/zones/<zone>/<vnet>' | À faire |
| GET | `/nodes/{node}/sdn/zones` | Get status for all zones. | Only list entries where you have 'SDN.Audit' | À faire |
| GET | `/nodes/{node}/sdn/zones/{zone}` | Directory index for SDN zone status. | SDN.Audit sur /sdn/zones/{zone} | Hors périmètre |
| GET | `/nodes/{node}/sdn/zones/{zone}/bridges` | Get a list of all bridges (vnets) that are part of a zone, as well as the ports that are members of that bridge. | SDN.Audit sur /sdn/zones/{zone} | À faire |
| GET | `/nodes/{node}/sdn/zones/{zone}/content` | List zone content. | SDN.Audit sur /sdn/zones/{zone} | À faire |
| GET | `/nodes/{node}/sdn/zones/{zone}/ip-vrf` | Get the IP VRF of an EVPN zone. | SDN.Audit sur /sdn/zones/{zone} | À faire |

### Nœud : services

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/services` | Service list. | Sys.Audit sur /nodes/{node} | Fait |
| GET | `/nodes/{node}/services/{service}` | Directory index | Sys.Audit sur /nodes/{node} | Hors périmètre |
| POST | `/nodes/{node}/services/{service}/reload` | Reload service. Falls back to restart if service cannot be reloaded. | Sys.Modify sur /nodes/{node} | À faire |
| POST | `/nodes/{node}/services/{service}/restart` | Hard restart service. Use reload if you want to reduce interruptions. | Sys.Modify sur /nodes/{node} | À faire |
| POST | `/nodes/{node}/services/{service}/start` | Start service. | Sys.Modify sur /nodes/{node} | À faire |
| GET | `/nodes/{node}/services/{service}/state` | Read service properties | Sys.Audit sur /nodes/{node} | À faire |
| POST | `/nodes/{node}/services/{service}/stop` | Stop service. | Sys.Modify sur /nodes/{node} | À faire |

### Nœud : spiceshell

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/spiceshell` | Creates a SPICE shell. | Sys.Console sur /nodes/{node} | À faire |

### Nœud : startall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/startall` | Start all VMs and containers located on this node (by default only those with onboot=1). | The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. | À faire |

### Nœud : status

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/status` | Read node status | Sys.Audit sur /nodes/{node} | Fait |
| POST | `/nodes/{node}/status` | Reboot or shutdown a node. | Sys.PowerMgmt sur /nodes/{node} | À faire |

### Nœud : stopall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/stopall` | Stop all VMs and Containers. | The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. | À faire |

### Nœud : subscription

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/subscription` | Read subscription info. | tout utilisateur connecté | Fait |
| POST | `/nodes/{node}/subscription` | Update subscription info. | Sys.Modify sur /nodes/{node} | À faire |
| PUT | `/nodes/{node}/subscription` | Set subscription key. | Sys.Modify sur /nodes/{node} | À faire |
| DELETE | `/nodes/{node}/subscription` | Delete subscription key of this node. | Sys.Modify sur /nodes/{node} | À faire |

### Nœud : suspendall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/suspendall` | Suspend all VMs. | The 'VM.PowerMgmt' permission is required on '/' or on '/vms/<ID>' for each ID passed via the 'vms' parameter. Additionally, you need 'VM.Config.Disk' on the '… | À faire |

### Nœud : syslog

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/syslog` | Read system log | Sys.Syslog sur /nodes/{node} | Fait |

### Nœud : tasks

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/tasks` | Read task list for one node (finished tasks). | List task associated with the current user, or all task the user has 'Sys.Audit' permissions on /nodes/<node> (the <node> the task runs on). | Fait |
| GET | `/nodes/{node}/tasks/{upid}` | (sans description) | tout utilisateur connecté | Hors périmètre |
| DELETE | `/nodes/{node}/tasks/{upid}` | Stop a task. | The user needs 'Sys.Modify' permissions on '/nodes/<node>' if they aren't the owner of the task. | À faire |
| GET | `/nodes/{node}/tasks/{upid}/log` | Read task log. | The user needs 'Sys.Audit' permissions on '/nodes/<node>' if they aren't the owner of the task. | Fait |
| GET | `/nodes/{node}/tasks/{upid}/status` | Read task status. | The user needs 'Sys.Audit' permissions on '/nodes/<node>' if they are not the owner of the task. | Fait |

### Nœud : termproxy

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/termproxy` | Creates a VNC Shell proxy. | Sys.Console sur /nodes/{node} | À faire |

### Nœud : time

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/time` | Read server time and time zone settings. | Sys.Audit sur /nodes/{node} | Fait |
| PUT | `/nodes/{node}/time` | Set time zone. | Sys.Modify sur /nodes/{node} | À faire |

### Nœud : version

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/version` | API version details | tout utilisateur connecté | À faire |

### Nœud : vncshell

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/vncshell` | Creates a VNC Shell proxy. | Sys.Console sur /nodes/{node} | À faire |

### Nœud : vncwebsocket

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/vncwebsocket` | Opens a websocket for VNC traffic. | Sys.Console sur /nodes/{node} | À faire |

### Nœud : vzdump

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/vzdump` | Create backup. | The user needs 'VM.Backup' permissions on any VM, and 'Datastore.AllocateSpace' on the backup storage (and fleecing storage when fleecing is used). The 'tmpdir… | Fait |
| GET | `/nodes/{node}/vzdump/defaults` | Get the currently configured vzdump defaults. | The user needs 'Datastore.Audit' or 'Datastore.AllocateSpace' permissions for the specified storage (or default storage if none specified). Some properties are… | À faire |
| GET | `/nodes/{node}/vzdump/extractconfig` | Extract configuration from vzdump backup archive. | The user needs 'VM.Backup' permissions on the backed up guest ID, and 'Datastore.AllocateSpace' on the backup storage. | À faire |

### Nœud : wakeonlan

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/wakeonlan` | Try to wake a node via 'wake on LAN' network packet. | Sys.PowerMgmt sur /nodes/{node} | À faire |

## VM QEMU

97 points d'entrée : 41 faits, 49 à faire, 7 hors périmètre.

### VM QEMU : (racine)

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu` | Virtual machine index (per node). | Only list VMs where you have VM.Audit permissions on /vms/<vmid>. | À faire |
| POST | `/nodes/{node}/qemu` | Create or restore a virtual machine. | You need 'VM.Allocate' permissions on /vms/{vmid} or on the VM pool /pool/{pool}. For restore (option 'archive'), it is enough if the user has 'VM.Backup' perm… | Fait |
| GET | `/nodes/{node}/qemu/{vmid}` | Directory index | tout utilisateur connecté | Hors périmètre |
| DELETE | `/nodes/{node}/qemu/{vmid}` | Destroy the VM and all used/owned volumes. Removes any VM specific permissions and firewall rules | VM.Allocate sur /vms/{vmid} | Fait |

### VM QEMU : agent

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/agent` | QEMU Guest Agent command index. | tout utilisateur connecté | Hors périmètre |
| POST | `/nodes/{node}/qemu/{vmid}/agent` | Execute QEMU Guest Agent commands. | VM.GuestAgent.Unrestricted ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/exec` | Executes the given command in the vm via the guest-agent and returns an object with the pid. | VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/exec-status` | Gets the status of the given pid started by the guest-agent | VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/file-read` | Reads the given file via guest agent. Is limited to 16777216 bytes. | VM.GuestAgent.FileRead ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/file-write` | Writes the given file via guest agent. | VM.GuestAgent.FileWrite ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/fsfreeze-freeze` | Execute fsfreeze-freeze. | VM.GuestAgent.FileSystemMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/fsfreeze-status` | Execute fsfreeze-status. | VM.GuestAgent.Audit ou VM.GuestAgent.FileSystemMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/fsfreeze-thaw` | Execute fsfreeze-thaw. | VM.GuestAgent.FileSystemMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/fstrim` | Execute fstrim. | VM.GuestAgent.FileSystemMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-fsinfo` | Execute get-fsinfo. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-host-name` | Execute get-host-name. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-memory-block-info` | Execute get-memory-block-info. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-memory-blocks` | Execute get-memory-blocks. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-osinfo` | Execute get-osinfo. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-time` | Execute get-time. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-timezone` | Execute get-timezone. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-users` | Execute get-users. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/get-vcpus` | Execute get-vcpus. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/info` | Execute info. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces` | Execute network-get-interfaces. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/agent/ping` | Execute ping. | VM.GuestAgent.Audit ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/set-user-password` | Sets the password for the given user to the given password | VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/shutdown` | Execute shutdown. | VM.PowerMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/suspend-disk` | Execute suspend-disk. | VM.PowerMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/suspend-hybrid` | Execute suspend-hybrid. | VM.PowerMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/agent/suspend-ram` | Execute suspend-ram. | VM.PowerMgmt ou VM.GuestAgent.Unrestricted sur /vms/{vmid} | À faire |

### VM QEMU : clone

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/clone` | Create a copy of virtual machine/template. | VM.Clone sur /vms/{vmid} et (VM.Allocate sur /vms/{newid} ou VM.Allocate sur /pool/{pool}) | Fait |

### VM QEMU : cloudinit

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/cloudinit` | Get the cloudinit configuration with both current and pending values. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/qemu/{vmid}/cloudinit` | Regenerate and change cloudinit config drive. | VM.Config.Cloudinit sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/cloudinit/dump` | Get automatically generated cloudinit config. | VM.Audit sur /vms/{vmid} | Fait |

### VM QEMU : config

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/config` | Get the virtual machine configuration with pending configuration changes applied. Set the 'current' parameter to get the current configuration instead. | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/config` | Set virtual machine options (asynchronous API). | VM.Config.Disk ou VM.Config.CDROM ou VM.Config.CPU ou VM.Config.Memory ou VM.Config.Network ou VM.Config.HWType ou VM.Config.Options ou VM.Config.Cloudinit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/qemu/{vmid}/config` | Set virtual machine options (synchronous API) - You should consider using the POST method instead for any actions involving hotplug or storage allocation. | VM.Config.Disk ou VM.Config.CDROM ou VM.Config.CPU ou VM.Config.Memory ou VM.Config.Network ou VM.Config.HWType ou VM.Config.Options ou VM.Config.Cloudinit sur /vms/{vmid} | Fait |

### VM QEMU : dbus-vmstate

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/dbus-vmstate` | Control the dbus-vmstate helper for a given running VM. | VM.Migrate sur /vms/{vmid} | À faire |

### VM QEMU : feature

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/feature` | Check if feature for virtual machine is available. | VM.Audit sur /vms/{vmid} | À faire |

### VM QEMU : firewall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/firewall` | Directory index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/aliases` | List aliases | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/firewall/aliases` | Create IP or Network Alias. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/aliases/{name}` | Read alias. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/qemu/{vmid}/firewall/aliases/{name}` | Update IP or Network alias. | VM.Config.Network sur /vms/{vmid} | Fait |
| DELETE | `/nodes/{node}/qemu/{vmid}/firewall/aliases/{name}` | Remove IP or Network alias. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/ipset` | List IPSets | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/firewall/ipset` | Create new IPSet | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/ipset/{name}` | List IPSet content | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/firewall/ipset/{name}` | Add IP or Network to IPSet. | VM.Config.Network sur /vms/{vmid} | Fait |
| DELETE | `/nodes/{node}/qemu/{vmid}/firewall/ipset/{name}` | Delete IPSet | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr}` | Read IP or Network settings from IPSet. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr}` | Update IP or Network settings | VM.Config.Network sur /vms/{vmid} | À faire |
| DELETE | `/nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr}` | Remove IP or Network from IPSet. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/log` | Read firewall log | VM.Console sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/options` | Get VM firewall options. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/qemu/{vmid}/firewall/options` | Set Firewall options. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/refs` | Lists possible IPSet/Alias reference which are allowed in source/dest properties. | VM.Audit sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/rules` | List rules. | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/firewall/rules` | Create new rule. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/firewall/rules/{pos}` | Get single rule data. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/qemu/{vmid}/firewall/rules/{pos}` | Modify rule data. | VM.Config.Network sur /vms/{vmid} | Fait |
| DELETE | `/nodes/{node}/qemu/{vmid}/firewall/rules/{pos}` | Delete rule. | VM.Config.Network sur /vms/{vmid} | Fait |

### VM QEMU : migrate

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/migrate` | Get preconditions for migration. | VM.Migrate sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/migrate` | Migrate virtual machine. Creates a new migration task. | VM.Migrate sur /vms/{vmid} | Fait |

### VM QEMU : monitor

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/monitor` | Execute QEMU monitor commands. | Sys.Audit ou Sys.Modify sur /vms/{vmid} | À faire |

### VM QEMU : move_disk

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/move_disk` | Move volume to different storage or to a different VM. | VM.Config.Disk sur /vms/{vmid} | Fait |

### VM QEMU : mtunnel

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/mtunnel` | Migration tunnel endpoint - only for internal use by VM migration. | VM.Allocate sur /vms/{vmid} et Sys.Incoming sur / | Hors périmètre |

### VM QEMU : mtunnelwebsocket

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/mtunnelwebsocket` | Migration tunnel endpoint for websocket upgrade - only for internal use by VM migration. | You need to pass a ticket valid for the selected socket. Tickets can be created via the mtunnel API call, which will check permissions accordingly. | Hors périmètre |

### VM QEMU : pending

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/pending` | Get the virtual machine configuration with both current and pending values. | VM.Audit sur /vms/{vmid} | Fait |

### VM QEMU : remote_migrate

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/remote_migrate` | Migrate virtual machine to a remote cluster. Creates a new migration task. EXPERIMENTAL feature! | VM.Migrate sur /vms/{vmid} | À faire |

### VM QEMU : resize

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| PUT | `/nodes/{node}/qemu/{vmid}/resize` | Extend volume size. | VM.Config.Disk sur /vms/{vmid} | Fait |

### VM QEMU : rrd

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/rrd` | Read VM RRD statistics (returns PNG) | VM.Audit sur /vms/{vmid} | À faire |

### VM QEMU : rrddata

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/rrddata` | Read VM RRD statistics | VM.Audit sur /vms/{vmid} | Fait |

### VM QEMU : sendkey

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| PUT | `/nodes/{node}/qemu/{vmid}/sendkey` | Send key event to virtual machine. | VM.Console sur /vms/{vmid} | À faire |

### VM QEMU : snapshot

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/snapshot` | List all snapshots. | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/snapshot` | Snapshot a VM. | VM.Snapshot sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/snapshot/{snapname}` | (sans description) | tout utilisateur connecté | Hors périmètre |
| DELETE | `/nodes/{node}/qemu/{vmid}/snapshot/{snapname}` | Delete a VM snapshot. | VM.Snapshot sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config` | Get snapshot configuration | VM.Snapshot ou VM.Snapshot.Rollback ou VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config` | Update snapshot metadata. | VM.Snapshot sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/snapshot/{snapname}/rollback` | Rollback VM state to specified snapshot. | VM.Snapshot ou VM.Snapshot.Rollback sur /vms/{vmid} | Fait |

### VM QEMU : spiceproxy

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/spiceproxy` | Returns a SPICE configuration to connect to the VM. | VM.Console sur /vms/{vmid} | À faire |

### VM QEMU : status

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/status` | Directory index | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/qemu/{vmid}/status/current` | Get virtual machine status. | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/status/reboot` | Reboot the VM by shutting it down, and starting it again. Applies pending changes. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/status/reset` | Reset virtual machine. | VM.PowerMgmt sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/status/resume` | Resume virtual machine. | VM.PowerMgmt sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/qemu/{vmid}/status/shutdown` | Shutdown virtual machine. This is similar to pressing the power button on a physical machine. This will send an ACPI event for the guest OS, which should then proceed to a clean shutdown. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/status/start` | Start virtual machine. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/status/stop` | Stop virtual machine. The qemu process will exit immediately. This is akin to pulling the power plug of a running computer and may damage the VM data. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/qemu/{vmid}/status/suspend` | Suspend virtual machine. | VM.PowerMgmt sur /vms/{vmid} | À faire |

### VM QEMU : template

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/template` | Create a Template. | VM.Allocate sur /vms/{vmid} | Fait |

### VM QEMU : termproxy

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/termproxy` | Creates a TCP proxy connections. | VM.Console sur /vms/{vmid} | À faire |

### VM QEMU : unlink

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| PUT | `/nodes/{node}/qemu/{vmid}/unlink` | Unlink/delete disk images. | VM.Config.Disk sur /vms/{vmid} | À faire |

### VM QEMU : vncproxy

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/qemu/{vmid}/vncproxy` | Creates a TCP VNC proxy connections. | VM.Console sur /vms/{vmid} | À faire |

### VM QEMU : vncwebsocket

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/qemu/{vmid}/vncwebsocket` | Opens a websocket for VNC traffic. | VM.Console sur /vms/{vmid} | À faire |

## Conteneur LXC

62 points d'entrée : 39 faits, 17 à faire, 6 hors périmètre.

### Conteneur LXC : (racine)

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc` | LXC container index (per node). | Only list CTs where you have VM.Audit permission on /vms/<vmid>. | À faire |
| POST | `/nodes/{node}/lxc` | Create or restore a container. | You need 'VM.Allocate' permission on /vms/{vmid} or on the VM pool /pool/{pool}. For restore, it is enough if the user has 'VM.Backup' permission and the VM al… | Fait |
| GET | `/nodes/{node}/lxc/{vmid}` | Directory index | tout utilisateur connecté | Hors périmètre |
| DELETE | `/nodes/{node}/lxc/{vmid}` | Destroy the container (also delete all uses files). | VM.Allocate sur /vms/{vmid} | Fait |

### Conteneur LXC : clone

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/clone` | Create a container clone/copy | VM.Clone sur /vms/{vmid} et (VM.Allocate sur /vms/{newid} ou VM.Allocate sur /pool/{pool}) | Fait |

### Conteneur LXC : config

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/config` | Get container configuration. | VM.Audit sur /vms/{vmid} | Fait |
| PUT | `/nodes/{node}/lxc/{vmid}/config` | Set container options. | VM.Config.Disk ou VM.Config.CPU ou VM.Config.Memory ou VM.Config.Network ou VM.Config.Options sur /vms/{vmid} | Fait |

### Conteneur LXC : feature

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/feature` | Check if feature for virtual machine is available. | VM.Audit sur /vms/{vmid} | À faire |

### Conteneur LXC : firewall

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/firewall` | Directory index. | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/aliases` | List aliases | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/firewall/aliases` | Create IP or Network Alias. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/aliases/{name}` | Read alias. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/lxc/{vmid}/firewall/aliases/{name}` | Update IP or Network alias. | VM.Config.Network sur /vms/{vmid} | Fait |
| DELETE | `/nodes/{node}/lxc/{vmid}/firewall/aliases/{name}` | Remove IP or Network alias. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/ipset` | List IPSets | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/firewall/ipset` | Create new IPSet | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/ipset/{name}` | List IPSet content | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/firewall/ipset/{name}` | Add IP or Network to IPSet. | VM.Config.Network sur /vms/{vmid} | Fait |
| DELETE | `/nodes/{node}/lxc/{vmid}/firewall/ipset/{name}` | Delete IPSet | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr}` | Read IP or Network settings from IPSet. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr}` | Update IP or Network settings | VM.Config.Network sur /vms/{vmid} | À faire |
| DELETE | `/nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr}` | Remove IP or Network from IPSet. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/log` | Read firewall log | VM.Console sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/options` | Get VM firewall options. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/lxc/{vmid}/firewall/options` | Set Firewall options. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/refs` | Lists possible IPSet/Alias reference which are allowed in source/dest properties. | VM.Audit sur /vms/{vmid} | À faire |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/rules` | List rules. | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/firewall/rules` | Create new rule. | VM.Config.Network sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/firewall/rules/{pos}` | Get single rule data. | VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/lxc/{vmid}/firewall/rules/{pos}` | Modify rule data. | VM.Config.Network sur /vms/{vmid} | Fait |
| DELETE | `/nodes/{node}/lxc/{vmid}/firewall/rules/{pos}` | Delete rule. | VM.Config.Network sur /vms/{vmid} | Fait |

### Conteneur LXC : interfaces

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/interfaces` | Get IP addresses of the specified container interface. | VM.Audit sur /vms/{vmid} | Fait |

### Conteneur LXC : migrate

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/migrate` | Get preconditions for migration. | VM.Migrate sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/migrate` | Migrate the container to another node. Creates a new migration task. | VM.Migrate sur /vms/{vmid} | Fait |

### Conteneur LXC : move_volume

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/move_volume` | Move a rootfs-/mp-volume to a different storage or to a different container. | VM.Config.Disk sur /vms/{vmid} | Fait |

### Conteneur LXC : mtunnel

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/mtunnel` | Migration tunnel endpoint - only for internal use by CT migration. | VM.Allocate sur /vms/{vmid} et Sys.Incoming sur / | Hors périmètre |

### Conteneur LXC : mtunnelwebsocket

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/mtunnelwebsocket` | Migration tunnel endpoint for websocket upgrade - only for internal use by VM migration. | You need to pass a ticket valid for the selected socket. Tickets can be created via the mtunnel API call, which will check permissions accordingly. | Hors périmètre |

### Conteneur LXC : pending

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/pending` | Get container configuration, including pending changes. | VM.Audit sur /vms/{vmid} | Fait |

### Conteneur LXC : remote_migrate

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/remote_migrate` | Migrate the container to another cluster. Creates a new migration task. EXPERIMENTAL feature! | VM.Migrate sur /vms/{vmid} | À faire |

### Conteneur LXC : resize

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| PUT | `/nodes/{node}/lxc/{vmid}/resize` | Resize a container mount point. | VM.Config.Disk sur /vms/{vmid} | Fait |

### Conteneur LXC : rrd

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/rrd` | Read VM RRD statistics (returns PNG) | VM.Audit sur /vms/{vmid} | À faire |

### Conteneur LXC : rrddata

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/rrddata` | Read VM RRD statistics | VM.Audit sur /vms/{vmid} | Fait |

### Conteneur LXC : snapshot

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/snapshot` | List all snapshots. | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/snapshot` | Snapshot a container. | VM.Snapshot sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/snapshot/{snapname}` | (sans description) | tout utilisateur connecté | Hors périmètre |
| DELETE | `/nodes/{node}/lxc/{vmid}/snapshot/{snapname}` | Delete a LXC snapshot. | VM.Snapshot sur /vms/{vmid} | Fait |
| GET | `/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config` | Get snapshot configuration | VM.Snapshot ou VM.Snapshot.Rollback ou VM.Audit sur /vms/{vmid} | À faire |
| PUT | `/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config` | Update snapshot metadata. | VM.Snapshot sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/snapshot/{snapname}/rollback` | Rollback LXC state to specified snapshot. | VM.Snapshot ou VM.Snapshot.Rollback sur /vms/{vmid} | Fait |

### Conteneur LXC : spiceproxy

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/spiceproxy` | Returns a SPICE configuration to connect to the CT. | VM.Console sur /vms/{vmid} | À faire |

### Conteneur LXC : status

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/status` | Directory index | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/lxc/{vmid}/status/current` | Get virtual machine status. | VM.Audit sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/status/reboot` | Reboot the container by shutting it down, and starting it again. Applies pending changes. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/status/resume` | Resume the container. | VM.PowerMgmt sur /vms/{vmid} | À faire |
| POST | `/nodes/{node}/lxc/{vmid}/status/shutdown` | Shutdown the container. This will trigger a clean shutdown of the container, see lxc-stop(1) for details. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/status/start` | Start the container. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/status/stop` | Stop the container. This will abruptly stop all processes running in the container. | VM.PowerMgmt sur /vms/{vmid} | Fait |
| POST | `/nodes/{node}/lxc/{vmid}/status/suspend` | Suspend the container. This is experimental. | VM.PowerMgmt sur /vms/{vmid} | À faire |

### Conteneur LXC : template

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/template` | Create a Template. | VM.Allocate sur /vms/{vmid} | Fait |

### Conteneur LXC : termproxy

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/termproxy` | Creates a TCP proxy connection. | VM.Console sur /vms/{vmid} | À faire |

### Conteneur LXC : vncproxy

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/lxc/{vmid}/vncproxy` | Creates a TCP VNC proxy connections. | VM.Console sur /vms/{vmid} | À faire |

### Conteneur LXC : vncwebsocket

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/lxc/{vmid}/vncwebsocket` | Opens a websocket for VNC traffic. | VM.Console sur /vms/{vmid} | À faire |

## Stockage

33 points d'entrée : 7 faits, 24 à faire, 2 hors périmètre.

### Stockage : (racine)

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage` | Get status for all datastores. | Only list entries where you have 'Datastore.Audit' or 'Datastore.AllocateSpace' permissions on '/storage/<storage>' | Fait |
| GET | `/nodes/{node}/storage/{storage}` | (sans description) | Datastore.Audit ou Datastore.AllocateSpace sur /storage/{storage} | Hors périmètre |

### Stockage : content

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/content` | List storage content. | Datastore.Audit ou Datastore.AllocateSpace sur /storage/{storage} | Fait |
| POST | `/nodes/{node}/storage/{storage}/content` | Allocate disk images. | Datastore.AllocateSpace sur /storage/{storage} | À faire |
| GET | `/nodes/{node}/storage/{storage}/content/{volume}` | Get volume attributes | You need read access for the volume. | À faire |
| POST | `/nodes/{node}/storage/{storage}/content/{volume}` | Copy a volume. This is experimental code - do not use. | non précisée | À faire |
| PUT | `/nodes/{node}/storage/{storage}/content/{volume}` | Update volume attributes | You need read access for the volume. | À faire |
| DELETE | `/nodes/{node}/storage/{storage}/content/{volume}` | Delete volume | You need 'Datastore.Allocate' privilege on the storage (or 'Datastore.AllocateSpace' for backup volumes if you have VM.Backup privilege on the VM). | Fait |

### Stockage : définitions

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/storage` | Storage index. | Only list entries where you have 'Datastore.Audit' or 'Datastore.AllocateSpace' permissions on '/storage/<storage>' | À faire |
| POST | `/storage` | Create a new storage. | Datastore.Allocate sur /storage | À faire |
| GET | `/storage/{storage}` | Read storage configuration. | Datastore.Allocate sur /storage/{storage} | À faire |
| PUT | `/storage/{storage}` | Update storage configuration. | Datastore.Allocate sur /storage | À faire |
| DELETE | `/storage/{storage}` | Delete storage configuration. | Datastore.Allocate sur /storage | À faire |

### Stockage : download-url

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/storage/{storage}/download-url` | Download templates, ISO images, OVAs and VM images by using an URL. | Datastore.AllocateTemplate sur /storage/{storage} et (Sys.Audit + Sys.Modify sur / ou Sys.AccessNetwork sur /nodes/{node}) | Fait |

### Stockage : file-restore

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/file-restore/download` | Extract a file or directory (as zip archive) from a PBS backup. | You need read access for the volume. | Fait |
| GET | `/nodes/{node}/storage/{storage}/file-restore/list` | List files and directories for single file restore under the given path. | You need read access for the volume. | Fait |

### Stockage : identity

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/identity` | Return identity information for this storage instance. | Datastore.Audit ou Datastore.AllocateSpace sur /storage/{storage} | À faire |

### Stockage : import-metadata

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/import-metadata` | Get the base parameters for creating a guest which imports data from a foreign importable guest, like an ESXi VM | You need read access for the volume. | À faire |

### Stockage : oci-registry-pull

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/storage/{storage}/oci-registry-pull` | Pull an OCI image from a registry. | Datastore.AllocateTemplate sur /storage/{storage} et Sys.AccessNetwork sur /nodes/{node} | À faire |

### Stockage : prunebackups

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/prunebackups` | Get prune information for backups. NOTE: this is only a preview and might not be what a subsequent prune call does if backups are removed/added in the meantime. | Datastore.Audit ou Datastore.AllocateSpace sur /storage/{storage} | À faire |
| DELETE | `/nodes/{node}/storage/{storage}/prunebackups` | Prune backups. Only those using the standard naming scheme are considered. | You need the 'Datastore.Allocate' privilege on the storage (or if a VM ID is specified, 'Datastore.AllocateSpace' and 'VM.Backup' for the VM). | À faire |

### Stockage : rrd

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/rrd` | Read storage RRD statistics (returns PNG). | Datastore.Audit ou Datastore.AllocateSpace sur /storage/{storage} | À faire |

### Stockage : rrddata

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/rrddata` | Read storage RRD statistics. | Datastore.Audit ou Datastore.AllocateSpace sur /storage/{storage} | Fait |

### Stockage : scan

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/scan` | Index of available scan methods | tout utilisateur connecté | Hors périmètre |
| GET | `/nodes/{node}/scan/cifs` | Scan remote CIFS server. | Datastore.Allocate sur /storage | À faire |
| GET | `/nodes/{node}/scan/iscsi` | Scan remote iSCSI server. | Datastore.Allocate sur /storage | À faire |
| GET | `/nodes/{node}/scan/lvm` | List local LVM volume groups. | Datastore.Allocate sur /storage | À faire |
| GET | `/nodes/{node}/scan/lvmthin` | List local LVM Thin Pools. | Datastore.Allocate sur /storage | À faire |
| GET | `/nodes/{node}/scan/nfs` | Scan remote NFS server. | Datastore.Allocate sur /storage | À faire |
| GET | `/nodes/{node}/scan/pbs` | Scan remote Proxmox Backup Server. | Datastore.Allocate sur /storage | À faire |
| GET | `/nodes/{node}/scan/zfs` | Scan zfs pool list on local node. | Datastore.Allocate sur /storage | À faire |

### Stockage : status

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/nodes/{node}/storage/{storage}/status` | Read storage status. | Datastore.Audit ou Datastore.AllocateSpace sur /storage/{storage} | À faire |

### Stockage : upload

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/nodes/{node}/storage/{storage}/upload` | Upload templates, ISO images, OVAs and VM images. | Datastore.AllocateTemplate sur /storage/{storage} | À faire |

## Accès

45 points d'entrée : 14 faits, 28 à faire, 3 hors périmètre.

### Accès : (racine)

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access` | Directory index. | tout utilisateur connecté | Hors périmètre |

### Accès : acl

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/acl` | Get Access Control List (ACLs). | The returned list is restricted to objects where you have rights to modify permissions. | Fait |
| PUT | `/access/acl` | Update Access Control List (add or remove permissions). | droit de modifier les permissions sur {path} | Fait |

### Accès : domains

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/domains` | Authentication domain index. | aucune (public) | Fait |
| POST | `/access/domains` | Add an authentication server. | Realm.Allocate sur /access/realm | À faire |
| GET | `/access/domains/{realm}` | Get auth server configuration. | Realm.Allocate ou Sys.Audit sur /access/realm | À faire |
| PUT | `/access/domains/{realm}` | Update authentication server settings. | Realm.Allocate sur /access/realm | À faire |
| DELETE | `/access/domains/{realm}` | Delete an authentication server. | Realm.Allocate sur /access/realm | À faire |
| POST | `/access/domains/{realm}/sync` | Syncs users and/or groups from the configured LDAP to user.cfg. NOTE: Synced groups will have the name 'name-$realm', so make sure those groups do not exist to prevent overwriting. | Realm.AllocateUser sur /access/realm/{realm} et User.Modify sur /access/groups | À faire |

### Accès : groups

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/groups` | Group index. | The returned list is restricted to groups where you have 'User.Modify', 'Sys.Audit' or 'Group.Allocate' permissions on /access/groups/<group>. | Fait |
| POST | `/access/groups` | Create new group. | Group.Allocate sur /access/groups | À faire |
| GET | `/access/groups/{groupid}` | Get group configuration. | Sys.Audit ou Group.Allocate sur /access/groups | À faire |
| PUT | `/access/groups/{groupid}` | Update group data. | Group.Allocate sur /access/groups | À faire |
| DELETE | `/access/groups/{groupid}` | Delete group. | Group.Allocate sur /access/groups | À faire |

### Accès : openid

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/openid` | Directory index. | tout utilisateur connecté | Hors périmètre |
| POST | `/access/openid/auth-url` | Get the OpenId Authorization Url for the specified realm. | aucune (public) | À faire |
| POST | `/access/openid/login` | Verify OpenID authorization code and create a ticket. | aucune (public) | À faire |

### Accès : password

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| PUT | `/access/password` | Change user password. | soi-même uniquement ou (Realm.AllocateUser sur le domaine de l'utilisateur et User.Modify sur l'utilisateur ou son groupe) | À faire |

### Accès : permissions

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/permissions` | Retrieve effective permissions of given user/token. | Each user/token is allowed to dump their own permissions (or that of owned tokens). A user can dump the permissions of another user or their tokens if they hav… | Fait |

### Accès : roles

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/roles` | Role index. | tout utilisateur connecté | Fait |
| POST | `/access/roles` | Create new role. | Sys.Modify sur /access | Fait |
| GET | `/access/roles/{roleid}` | Get role configuration. | tout utilisateur connecté | À faire |
| PUT | `/access/roles/{roleid}` | Update an existing role. | Sys.Modify sur /access | Fait |
| DELETE | `/access/roles/{roleid}` | Delete role. | Sys.Modify sur /access | À faire |

### Accès : tfa

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/tfa` | List TFA configurations of users. | Returns all or just the logged-in user, depending on privileges. | Fait |
| GET | `/access/tfa/{userid}` | List TFA configurations of users. | soi-même uniquement ou User.Modify + Sys.Audit sur l'utilisateur ou son groupe | À faire |
| POST | `/access/tfa/{userid}` | Add a TFA entry for a user. | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | À faire |
| GET | `/access/tfa/{userid}/{id}` | Fetch a requested TFA entry if present. | soi-même uniquement ou User.Modify + Sys.Audit sur l'utilisateur ou son groupe | À faire |
| PUT | `/access/tfa/{userid}/{id}` | Add a TFA entry for a user. | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | À faire |
| DELETE | `/access/tfa/{userid}/{id}` | Delete a TFA entry by ID. | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | À faire |

### Accès : ticket

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/ticket` | Dummy. Useful for formatters which want to provide a login page. | aucune (public) | Hors périmètre |
| POST | `/access/ticket` | Create or verify authentication ticket. | aucune (public) | Fait |

### Accès : users

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/access/users` | User index. | The returned list is restricted to users where you have 'User.Modify' or 'Sys.Audit' permissions on '/access/groups' or on a group the user belongs too. But it… | Fait |
| POST | `/access/users` | Create new user. | Realm.AllocateUser sur le domaine de l'utilisateur et User.Modify sur l'utilisateur ou son groupe | Fait |
| GET | `/access/users/{userid}` | Get user configuration. | User.Modify + Sys.Audit sur l'utilisateur ou son groupe | À faire |
| PUT | `/access/users/{userid}` | Update user configuration. | User.Modify sur l'utilisateur ou son groupe | À faire |
| DELETE | `/access/users/{userid}` | Delete user. | Realm.AllocateUser sur le domaine de l'utilisateur et User.Modify sur l'utilisateur ou son groupe | À faire |
| GET | `/access/users/{userid}/tfa` | Get user TFA types (Personal and Realm). | soi-même uniquement ou User.Modify + Sys.Audit sur l'utilisateur ou son groupe | À faire |
| GET | `/access/users/{userid}/token` | Get user API tokens. | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | À faire |
| GET | `/access/users/{userid}/token/{tokenid}` | Get specific API token information. | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | À faire |
| POST | `/access/users/{userid}/token/{tokenid}` | Generate a new API token for a specific user. NOTE: returns API token value, which needs to be stored as it cannot be retrieved afterwards! | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | Fait |
| PUT | `/access/users/{userid}/token/{tokenid}` | Update API token for a specific user. NOTE: when 'regenerate' is set, the returned token value needs to be stored as it cannot be retrieved afterwards! | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | À faire |
| DELETE | `/access/users/{userid}/token/{tokenid}` | Remove API token for a specific user. | soi-même uniquement ou User.Modify sur l'utilisateur ou son groupe | Fait |
| PUT | `/access/users/{userid}/unlock-tfa` | Unlock a user's TFA authentication. | User.Modify sur l'utilisateur ou son groupe | À faire |

### Accès : vncticket

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| POST | `/access/vncticket` | verify VNC authentication ticket. | aucune (public) | À faire |

## Pools

7 points d'entrée : 1 faits, 6 à faire, 0 hors périmètre.

### Pools : pools

| Méthode | Chemin | Description | Permission | MyProxmox |
|---|---|---|---|---|
| GET | `/pools` | List pools or get pool configuration. | List all pools where you have Pool.Audit permissions on /pool/<pool>, or the pool specific with {poolid} | Fait |
| POST | `/pools` | Create new pool. | Pool.Allocate sur /pool/{poolid} | À faire |
| PUT | `/pools` | Update pool. | Pool.Allocate sur /pool/{poolid} | À faire |
| DELETE | `/pools` | Delete pool. | Pool.Allocate sur /pool/{poolid} | À faire |
| GET | `/pools/{poolid}` | Get pool configuration (deprecated, no support for nested pools, use 'GET /pools/?poolid={poolid}'). | Pool.Audit sur /pool/{poolid} | À faire |
| PUT | `/pools/{poolid}` | Update pool data (deprecated, no support for nested pools - use 'PUT /pools/?poolid={poolid}' instead). | Pool.Allocate sur /pool/{poolid} | À faire |
| DELETE | `/pools/{poolid}` | Delete pool (deprecated, no support for nested pools, use 'DELETE /pools/?poolid={poolid}'). | Pool.Allocate sur /pool/{poolid} | À faire |
