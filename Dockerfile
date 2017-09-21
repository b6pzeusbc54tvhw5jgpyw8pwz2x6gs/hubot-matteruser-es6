FROM node:argon

ARG hubot_owner
ARG hubot_description
ARG hubot_name

RUN useradd -m -s /bin/bash hubot-matteruser-es6

RUN mkdir -p /usr/src/hubot-matteruser-es6
RUN chown hubot-matteruser-es6:hubot-matteruser-es6 /usr/src/hubot-matteruser-es6
RUN chown hubot-matteruser-es6:hubot-matteruser-es6 /usr/local/lib/node_modules/
RUN chown hubot-matteruser-es6:hubot-matteruser-es6 /usr/local/bin/

WORKDIR /usr/src/hubot-matteruser-es6
USER hubot-matteruser-es6
RUN npm install -g yo
RUN npm install -g generator-hubot

RUN echo "No" | yo hubot --adapter matteruser-es6 --owner="${hubot_owner}" --name="${hubot_name}" --description="${hubot_desciption}" --defaults \
&& sed -i '/heroku/d' external-scripts.json

RUN rm hubot-scripts.json

CMD ["-a", "matteruser-es6"]
ENTRYPOINT ["./bin/hubot"]

EXPOSE 8080
