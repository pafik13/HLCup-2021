#!/bin/bash

INDEX=49

while [ $INDEX -lt 70 ]
do
  REMAINDER=$(( $INDEX % 2 )) 
  if [ $REMAINDER -ne 0 ]

  then
    echo $INDEX
    docker build --build-arg GLOBAL_OFFSET_X=$INDEX -t hlcup2021/ts .
    docker tag hlcup2021/ts:latest stor.highloadcup.ru/rally/tall_yak
    docker push stor.highloadcup.ru/rally/tall_yak

    SECOND=$(($INDEX+2))
    echo $SECOND
    docker build --build-arg GLOBAL_OFFSET_X=$SECOND -t hlcup2021/ts .
    docker tag hlcup2021/ts:latest stor.highloadcup.ru/rally/invisible_owl
    docker push stor.highloadcup.ru/rally/invisible_owl

    docker system prune -f
  fi
  
  INDEX=$(($INDEX+1))
done