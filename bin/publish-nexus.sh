#!/bin/bash

echo ""
echo ">>> Publish naar Nexus <<<"
echo ""
. $(dirname "$0")/_init.sh
cd $BASEDIR/dist
if [ ! -z $BAMBOO_AGENT_HOME ]; then
  echo bouwen onder bamboo: klaarmaken voor nexus
  npm run publishToNexus
  npm publish
else
  echo "Lokaal kan je niet naar Nexus publishen, enkel Bamboo kan dat"
fi
