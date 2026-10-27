# Eco-Devices (GCE Electronics)

Intégration **non officielle**, sans lien avec GCE Electronics. Elle lit un
**Eco-Devices** (le module téléinfo sur rail DIN, **pas l'Eco-Devices RT2**,
qui a une autre API) par son **API JSON locale**, sans cloud. **Lecture
seule** : elle n'envoie que des requêtes de lecture, l'Eco-Devices ne reçoit
aucune commande.

**Jamais testé avec un vrai Eco-Devices** : construit à partir de la
documentation de GCE Electronics (wiki, section « API JSON ») et des
bibliothèques pyecodevices et ecodevices (Home Assistant).

## Ce que vous obtenez

Un appareil par entrée utilisée :

- **Téléinfo 1** et **Téléinfo 2** (un compteur électrique en mode
  **historique** sur l'entrée : Linky en mode historique ou compteur
  électronique) :
  - **Puissance apparente** (VA) : la valeur PAPP du compteur, lue toutes les
    15 secondes ; les contrats d'énergie de Gladys la comparent à votre
    puissance souscrite ;
  - **Index de consommation** (kWh) : la somme des index de l'option
    tarifaire du compteur (base ; heures creuses + heures pleines ; EJP ;
    les six index Tempo), envoyée une fois par minute ; c'est la valeur que le
    suivi énergétique de Gladys transforme en consommation et en coût ;
  - chaque **index tarifaire** (kWh) en simple capteur, pour information
    (jamais compté dans le suivi énergétique).
- **Compteur 1** et **Compteur 2** (les entrées d'impulsions), seulement si
  vous les réglez sur **eau** ou **gaz** dans la configuration :
  - **Index** (m³) : l'index total du compteur ;
  - **Consommation du jour** (m³) : remise à zéro chaque jour par
    l'Eco-Devices, à l'heure réglée dans sa page de configuration.

L'eau et le gaz ne passent pas par le suivi énergétique de Gladys (ce sont
des volumes, pas des kWh).

Ce n'est **pas** l'intégration `gladys-teleinfo` (une clé USB LiXee) : si
votre compteur est déjà lu par une autre intégration, n'en gardez qu'une, sinon
la consommation serait comptée deux fois. De même, si Téléinfo 2 est un
sous-compteur de Téléinfo 1, rangez-le sous le compteur principal dans le
suivi énergétique de Gladys.

## Configuration

1. Trouvez l'adresse IP de l'Eco-Devices (dans votre box ou avec GCE
   ScanDevice) et donnez-lui de préférence une adresse fixe.
2. Vérifiez que l'API JSON répond : ouvrez
   `http://<adresse>/api/xdevices.json?cmd=10` dans un navigateur ; vous
   devez voir une réponse qui commence par `{"product":"Eco-devices"`. Sinon,
   mettez à jour le firmware de l'Eco-Devices.
3. Dans Gladys, installez l'intégration puis remplissez :
   - **Adresse de l'Eco-Devices** (avec un port seulement s'il n'est pas 80) ;
   - **Nom d'utilisateur** et **mot de passe**, seulement si l'accès sécurisé
     de l'Eco-Devices est activé (onglet Système, bloc Sécurité). Le mot de
     passe est gardé par Gladys dans sa base, jamais réaffiché, jamais écrit
     dans les journaux, envoyé seulement à l'adresse de l'Eco-Devices (en
     authentification HTTP Basic, en HTTP simple sur votre réseau : c'est ce
     que propose l'Eco-Devices). Un mot de passe sans nom d'utilisateur est
     refusé ;
   - pour chaque **compteur d'impulsions** : eau, gaz ou « non utilisé », et
     l'**unité de son index** sur l'Eco-Devices (litres par défaut, le réglage
     le plus courant : 1 impulsion = 1 litre ; sinon mètres cubes). Comparez
     l'index affiché par Gladys avec celui du compteur lui-même. Choisissez-les
     **avant** de créer l'appareil : changer d'unité ensuite fait sauter ou
     baisser l'index (voir plus bas).
4. Enregistrez, puis créez les appareils depuis l'onglet **Découverte**.

Le bouton **Tester la connexion** lit l'Eco-Devices une fois quand une
lecture est due (jamais plus d'une toutes les 15 secondes), sinon donne la
dernière lecture.

## Garde des index

Le suivi énergétique compte chaque hausse d'un index en entier. Pour qu'un
index faux (un compteur remplacé, une erreur de lecture) soit retenu au lieu
d'être facturé :

- un index à 0 n'est jamais envoyé ;
- une hausse plus grande que ce que le logement peut consommer depuis la
  dernière valeur (100 kW en électricité, 10 m³/h en eau, 16 m³/h en gaz)
  est un **saut** ; une valeur plus basse que la dernière est une **baisse** ;
- un saut ou une baisse est **retenu** : la dernière valeur acceptée est
  renvoyée, l'état de l'intégration l'affiche, et il est gardé dans `/data`
  au redémarrage. Ni le temps ni la répétition ne le confirment ;
- **un saut** juste (et, pour un compteur d'eau ou de gaz, **une baisse**
  juste, par exemple après avoir corrigé l'index saisi dans l'Eco-Devices) se
  prend en **deux clics** sur « Accepter l'index retenu » : le premier clic
  liste les valeurs retenues et ne prend rien ; le second, de quelques
  secondes à 5 minutes plus tard, prend les valeurs listées (plus ce que le
  compteur a pu mesurer entre-temps), seulement si elles n'ont pas changé
  autrement. Enregistrer la configuration n'accepte rien. Le badge de
  l'appareil passe à l'orange tant qu'un index est retenu ;
- changer l'**unité** d'un compteur d'impulsions dans la configuration
  (litres ou m³) convertit la valeur de référence : ni saut ni baisse ;
- **une baisse de l'index de consommation téléinfo n'est jamais acceptée**
  (c'est une somme d'index : elle ne baisse que si c'est un autre compteur).
  Elle arrive quand le compteur est **remplacé**, ou quand l'**option
  tarifaire change** (base vers heures creuses ou Tempo, par exemple) et que
  le compteur repart de zéro sur les nouveaux index. L'état de l'intégration
  le dit (« BAISSE d'index de consommation retenue, jamais acceptée »). La
  seule sortie est de **supprimer l'appareil** de cette entrée puis de le
  **recréer** depuis l'onglet Découverte. Ce que cela coûte :
  - tout l'historique de l'appareil est perdu : index, puissance, et la
    **consommation et le coût** calculés par le suivi énergétique ;
  - il faut le replacer dans l'arbre énergie et le rattacher à votre contrat ;
  - Gladys refuse de supprimer un appareil de plus de 5000 états (environ
    21 heures de puissance à une valeur toutes les 15 secondes) : il les purge
    en arrière-plan, réessayez plus tard.
    Garder l'historique sans accepter la baisse (un nouvel appareil créé à côté
    de l'ancien) n'est pas possible dans cette version ;
- pour un index électrique en plusieurs tarifs, l'index total n'est construit
  que si tous les index de l'option sont lus ; un index tarifaire qui revient
  à 0 ou qui baisse seul est une erreur de lecture : pas d'index cette
  fois-là.

## Fonctionnement

- Une lecture toutes les 15 secondes (`cmd=10`), jamais plus souvent, même
  après un redémarrage, un enregistrement de la configuration, un clic ou une
  reconnexion (l'heure de la dernière lecture est gardée dans `/data`).
- La consommation du jour (`cmd=20`) est lue toutes les 5 minutes, seulement
  si un compteur d'impulsions est réglé ; si elle échoue, les index continuent
  et elle est réessayée après 5 minutes, puis 10, jusqu'à 1 heure.
- Une seule requête à la fois vers l'Eco-Devices.
- Si l'Eco-Devices ne répond pas : nouvel essai après 15 s, puis le double,
  jusqu'à 10 minutes. S'il répond 429 ou 5xx : pause de 1 minute à 6 heures,
  gardée au redémarrage.
- **Identifiants refusés** (401/403 sur la page des index) : les lectures
  s'arrêtent, même après un redémarrage, jusqu'à ce que vous changiez
  l'adresse, le nom d'utilisateur ou le mot de passe, ou que le bouton
  « Tester la connexion » réussisse. Un refus sur la page du jour ne compte
  pas comme un refus des identifiants.
- Si la puissance et tous les index d'une entrée téléinfo restent identiques
  15 minutes (câble téléinfo débranché ?), la puissance n'est plus envoyée.
- Si la configuration ne peut pas être lue depuis Gladys à la connexion, elle
  est redemandée après 5 s, puis le double, jusqu'à 5 minutes, sans fin.
- Si le fichier d'état dans `/data` ne peut pas être lu (ou écrit), aucun
  index n'est envoyé tant qu'il ne l'est pas (une valeur retenue peut s'y
  trouver) ; la puissance continue. Un fichier illisible n'est pas écrasé.
  S'il est abîmé (après une coupure de courant, par exemple), supprimez le
  fichier `ecodevices-state.json` du volume `/data` de l'intégration (sur
  l'hôte Docker de Gladys) puis redémarrez l'intégration : elle repart d'un
  état vide (les index retenus sont oubliés, et les appareils doivent être
  il faudra peut-être en accepter de nouveau).

## Limites

- Eco-Devices RT2 non pris en charge (autre API).
- Mode téléinfo **standard** du Linky non lu : passez le compteur en mode
  historique (demande à votre fournisseur) ou utilisez un autre module.
- Les compteurs d'impulsions sont lus en eau ou en gaz seulement (pas
  d'impulsions électriques).
- La couleur Tempo du jour et du lendemain n'est pas publiée.

## Dépannage

Si l'état dit que la réponse ne donne pas certains index (« la réponse ne
donne pas HCHP », par exemple), envoyez au développeur la réponse de
`cmd=10` ci-dessous : les noms des index des options heures creuses et EJP
sont déduits, pas encore confirmés sur un vrai Eco-Devices.

Sur le même réseau que l'Eco-Devices :

```bash
curl -s "http://192.168.1.20/api/xdevices.json?cmd=10"; echo
curl -s "http://192.168.1.20/api/xdevices.json?cmd=20"; echo
# avec l'accès sécurisé :
curl -s -u admin "http://192.168.1.20/api/xdevices.json?cmd=10"; echo
```
